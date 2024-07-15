const { parseRange } = require('../utils');
const Stream = require('stream');
const Path = require('path');
const {v2} = require('webdav-server');
const DB = require('./databases');
const Logger = require('../logger');

const Log = new Logger('WebDavFS');

class TGSerializer {
  fsApi = null;

  constructor(fsApi) {
    this.fsApi = fsApi;
  }

  uid() {
    return 'FSSerializer-1';
  }

  serialize(fileSystem, callback) {
    callback(null, {});
  }

  unserialize(serializedData, callback) {
    const fileSystem = new TGFileSystem(this.fsApi);
    callback(null, fileSystem);
  }
}


class TGResource extends v2.VirtualFileSystemResource {
  constructor(size, mtime, ctime, type) {
    const props = new v2.LocalPropertyManager();

    super({
      props,
      locks: new v2.LocalLockManager(),
      content: [],
      size: size || 0,
      lastModifiedDate: mtime || 0,
      creationDate: ctime || 0,
      type: type == 'folder' ? v2.ResourceType.Directory : v2.ResourceType.File,
    });
  }

  static async getItem(id) {
    const item = await DB.getItem(id);
    return TGResource.fromItem(item);
  }

  static fromItem(item) {
    let size = 0;
    if ( item.type !== 'folder' ) {
      size = item.parts.reduce( (acc, part) => acc += part.size, size);
    }
    return new TGResource(size, item.mtime, item.ctime, item.type);
  }
}

class TGFileSystem extends v2.VirtualFileSystem {

  resources = [];
  fsApi = null;

  constructor(fsApi) {
    super(new TGSerializer(fsApi));
    this.fsApi = fsApi;
    this.resources['/'] = new TGResource(fsApi.Root.size, fsApi.Root.mtime, fsApi.Root.ctime, 'folder');
  }

  async _creationDate(path, ctx, callback) {
    try {
      const dbFile = await this.fsApi.getLastFolder(path.toString()); 
      if ( dbFile ) {
        callback(null, dbFile.ctime);
      }
    } catch(e) {
      Log.error('[ctime]', e);
      callback(v2.Errors.ResourceNotFound);
    }
  }
  
  async _lastModifiedDate(path, ctx, callback) {
    try {
      const dbFile = await this.fsApi.getLastFolder(path.toString()); 
      if ( dbFile ) {
        callback(null, dbFile.mtime);
      }
    } catch(e) {
      Log.error('[mtime]', e);
      callback(v2.Errors.ResourceNotFound);
    }
  }

  async move(ctx, pathFrom, pathTo, overwrite, callback) {

    Log.info('[move]', `'${pathFrom.toString()}'`, '->', `'${pathTo.toString()}'`);
    try {

      await this.fsApi.move(pathFrom.toString(), pathTo.toString());
      Log.info('[move]', 'correctly moved file:', pathTo.toString());

      const sPath = pathFrom.toString(true);
      for (const itemPath in this.resources) {
        if (itemPath.startsWith(sPath)) {
          delete this.resources[itemPath];
        }
      }

      delete this.resources[pathFrom.toString()];

      callback(null, true);

    } catch(e) {
      Log.error('[move]', e);
      callback(v2.Errors.ResourceNotFound);
    }


  }

  async copy(ctx, pathFrom, pathTo, overwrite, callback) {

    Log.info('[copy]', `'${pathFrom.toString()}'`, '->', `'${pathTo.toString()}'`);

    const item = this.resources[ pathFrom.toString() ];
    if ( !item ) {
      return callback(v2.Errors.ResourceNotFound);
    }

    try {

      await this.fsApi.copy(pathFrom.toString(), pathTo.toString());
      Log.info('[copy]', 'correctly copied file:', pathTo.toString());
      callback(null, true);

    } catch(e) {
      Log.error('[copy]', e);
      callback(v2.Errors.ResourceNotFound);
    }
  }

  async rename(ctx, pathFrom, newName, callback) {
    Log.log('[rename]', `'${pathFrom.toString()}'`, `'${newName.toString()}'`);
    callback(v2.Errors.InvalidOperation);
  }

  async _fastExistCheck(ctx, path, callback) {
    if (this.resources[path.toString()]) {
      callback(true);
    } else {
      this._readDir(path, ctx, (err, resp) => {
        callback( !!this.resources[path.toString()] );
      });
    }
  }

  async _size(path, ctx, callback) {
    try {
      const size = await this.fsApi.size(path.toString());
      callback(null, size);
    } catch(e) {
      Log.error('[size]', e);
      callback(v2.Errors.ResourceNotFound);
    }
  }


  async _create(path, ctx, callback) {
    Log.info('[create]', `'${path.toString()}'`, ctx.type.isDirectory ? 'folder' : 'file');
    try {

      const dbFile = await this.fsApi.create(path.toString(), ctx.type.isDirectory);
      
      this.resources[path.toString()] = TGResource.fromItem(dbFile);
      callback(null, true);

    } catch(e) {
      Log.error('[create]', e);
      callback(v2.Errors.ResourceNotFound);
    }

  }

  async _readDir(path, ctx, callback) {
    Log.debug('[listdir]', `'${path.toString()}'`);
    try {

      const res = await this.fsApi.listDir(path.toString());
      const currentFolder = res.shift();

      this.resources[path.toString()] = TGResource.fromItem(currentFolder);

      const response = res.map((child) => {
        this.resources[ `${Path.join( path.toString(), child.filename)}` ] = TGResource.fromItem(child);
        return child.filename;
      });

      callback(null, response);

    } catch(e) {
      Log.error('[listdir]', e);
      callback(v2.Errors.ResourceNotFound);
    }

  }

  async _openReadStream(path, ctx, callback) {
    const stream = new Stream.PassThrough();

    const headerRange = ctx.context.headers.headers.range;
    const range = headerRange || '';

    Log.info('[readfile]', `'${path.toString()}'`, range || '');

    let {start, end} = parseRange(range);

    try {

      stream.pause();
      const service = await this.fsApi.readFileContent(path.toString(), {start, end}, stream);

      if ( service ) {
        // file will be read from telegram

        ctx.context.request.on('error', () => {
          if ( !service.aborted ) {
            service.stop();
            Log.warn('[readfile]', 'request has been aborted because of error')
          } 
        });
      
        ctx.context.request.on('aborted', () => {
          if ( !service.aborted ) {
            service.stop();
            Log.warn('[readfile]', 'request has been aborted because of aborted')
          } 
        });
      
        ctx.context.request.on('close', () => {
          if ( !service.aborted ) {
            service.stop();
            Log.warn('[readfile]', 'request has been aborted because of close')
          } 
        });


        if ( headerRange ) {
          const {context: {response}} = ctx;
          /**
           * WORKAROUND:
           * hanldle the response here, because the server implementation make rclone stucks
           */ 
          ctx.context.setCode(206);
          response.setHeader('Accept-Ranges', 'bytes');
          response.setHeader('Content-Length', String((service.Range.end - service.Range.start) + 1 ) );
          // TODO: calculate mime-type
          response.setHeader('Content-Type', 'application/octet-stream');
          response.setHeader('Content-Range', `bytes ${service.Range.start}-${service.Range.end}/service.Range.totalsize`);
          stream.pipe(response);
          stream.resume();
          return;
        }

      }

      callback(null, stream);

      if ( service ) {
        await service.execute(stream);
      } else {
        stream.end();
      }

    } catch(e) {
      Log.error('[readfile]', e);
      callback(v2.Errors.ResourceNotFound);
    }

  }


  async _delete(path, ctx, callback) {

    Log.info('[delete]', `'${path.toString()}'`);

    const resource = this.resources[path.toString()];
    if (!resource) {
      Log.warn('[delete]', `'${path.toString()}' not foundin cache`);
      return callback(v2.Errors.ResourceNotFound);
    }

    try {

      await this.fsApi.delete(path.toString(), true);

      const sPath = path.toString(true);
      for (const itemPath in this.resources) {
        if (itemPath.startsWith(sPath)) {
          delete this.resources[itemPath];
        }
      }

      delete this.resources[path.toString()];

      callback(null, true);

    } catch(e) {
      Log.error('[delete]', e);
      callback(v2.Errors.ResourceNotFound);
    }

  }


  async _openWriteStream(path, ctx, callback) {

    Log.info('[writefile]', `'${path.toString()}'`);

    const stream = new Stream.PassThrough();

    if (ctx.estimatedSize <= 0) {
      Log.info('[writefile]', 'skip upload because file is 0 bytes');
      return callback(null, stream);
    }

    try {

      const service = await this.fsApi.createFileWithContent(path.toString(), stream, (dbFile) => {
        this.resources[path.toString()] = TGResource.fromItem(dbFile);

        for (const cb of lastHandlers) {
          cb.apply(stream);
        }
        Log.debug('[writefile]', 'file correctly created and saved in cache');
      });

      if ( service ) {
        // NOTE: this code can be removed

        ctx.context.request.on('error', () => {
          if ( !service.aborted ) {
            service.stop();
            Log.warn('[writefile]', 'request has been aborted because of error')
          } 
        });
      
        ctx.context.request.on('aborted', () => {
          if ( !service.aborted ) {
            service.stop();
            Log.warn('[writefile]', 'request has been aborted because of aborted')
          } 
        });
      
        ctx.context.request.on('close', () => {
          if ( !service.aborted ) {
            service.stop();
            Log.warn('[writefile]', 'request has been aborted because of close')
          } 
        });
      }

      /**
       * WORKAROUND:
       * inputstream is flushed before uploading file on telegram.
       * So, we need to force the 'no-response' to the client 'till file
       * was uploaded on telegram.
       * We need to attach 'data' and 'finish' event-handler to inputstream;
       * after that we have to remove all event and pass the inputstream to caller.
       * In this way the 'caller' can add its event-handlers. 
       * Then, we can remove all 'finish' event-handlers and re-attach older event-handlers.
       * After upload (on telegram) is completed, we can manually call the caller's event-handlers
       * In this way the client is notified only once file is fully uploaded on telegram
       */


      // get *our* 'finish' handlers
      const finishHandlers = stream.listeners('finish');
      stream.removeAllListeners('finish');

      // start receiving data from 'caller'
      callback(null, stream);

      // get the caller's 'finish' event-handlers
      const lastHandlers = stream.listeners('finish');

      // remove all 'finish' event-handlers (from caller)
      stream.removeAllListeners('finish');

      // re-attach *our* 'finish' event-handlers
      for (const cb of finishHandlers) {
        stream.on('finish', cb);
      }

      await service.execute(stream);


    } catch(e) {
      Log.error('[writefile]', e);
      callback(v2.Errors.ResourceNotFound);
    }

  }

}


module.exports = TGFileSystem;