const {parseRange} = require('./utils');
const Logger = require('./logger');
const {Config} = require('./config');
const Express = require('express')
const Pug = require('pug');
const Path = require('path');
const DB = require('./services/databases');
const {ROOT_ID, UPLOAD_CHUNK} = require('./constants');
const Stream = require('stream');
const BasicAuth = require('express-basic-auth');
const FileUpload = require('express-fileupload');
const Multiparty = require('multiparty');

const App = Express()

App.get('/', function (req, res) {
  res.send('Hello World')
})


const FSApiLib = require('./services/fs-api');

const Log = new Logger('HttpServer');

let FSApi = null;

if ( Config.http.user && Config.http.pass ) {

  App.use(BasicAuth({
    users: { [Config.http.user]: Config.http.pass },
    challenge: true
  }));
}

App.set('view engine', 'pug')

App.use('/public/', Express.static( Path.join(__dirname, 'public') ));

App.get("/", (req, res, next) => {
  res.render("webUI/index");
});

App.get('/folder/:fldId', async (request, res, next) => {

  const {fldId} = request.params;

  if ( !fldId ) {
    res.status(422);
    return next({error: 'invalid folder id'});
  }

  const folder = await DB.getItem(fldId);
  if ( !folder || folder.type !== 'folder' ) {
    res.status(422);
    return next({error: `item ${fldId} is not a folder`});
  }

  const paths = await FSApiLib.buildPath(folder);
  const children = await FSApi.listDir(paths);

  return res.send( children.slice(1) );
});


App.get('/files/:fileid', async function (request, res, next) {
  // GET data from DB
  Log.info('new request for', request.params.fileid, 'with range:', request.headers.range);

  if ( !request.params.fileid ) {
    res.status(422);
    Log.error('invalid fileId');
    return next({error: 'invalid file id'});
  }

  const file = await DB.getItem( request.params.fileid );

  if ( !file || file.type == 'folder' ) {
    res.status(422);
    Log.error('file not found or is not a folder', !!file);
    return next({error: `file not found with id ${request.params.fileid}`});
  }

  // parse Range header 
  const headerRange = request.headers['range'];
  const range = headerRange || '';
  let {start, end} = parseRange(range);

  const path = await FSApiLib.buildPath(file);

  let totalsize = file.parts.reduce((acc, curr) => acc + curr.size, 0);

  if ( isNaN(start) ) {
    start = 0;
  }

  if ( isNaN(end) ) {
    end = totalsize - 1;
  }

  const service = await FSApi.readFileContent(path.toString(), {start, end}, res);

  if ( service ) {
    // file will be read from telegram

    request.on('error', () => {
      if ( !service.aborted ) {
        service.stop();
        Log.warn('request has been aborted because of error')
      } 
    });
  
    request.on('aborted', () => {
      if ( !service.aborted ) {
        service.stop();
        Log.warn('request has been aborted because of aborted')
      } 
    });
  
    request.on('close', () => {
      if ( !service.aborted ) {
        service.stop();
        Log.warn('request has been aborted because of close')
      } 
    });

  }

  res.status( headerRange ? 206 : 200);
      
  res.set('Content-Range', `bytes ${start}-${end}/${totalsize}`);
  res.set('content-length', (end - start) + 1);
  res.set('content-type', file.type);
  res.set("content-disposition", `inline; filename="${file.filename}"`);
  res.set("accept-ranges", "bytes");

  service.execute(res);
});

App.post('/folder/:fldid/file/:filename?', async function (request, res, next) {

  const {fldid: parentfolder, filename} = request.params;

  if ( !parentfolder) {
    res.status(422);
    return next('parentfolder must be specified');
  }

  if ( !DB.isUUID(parentfolder) ) {
    res.status(422);
    return next('parentfolder id mismsatch');
  }

  const parent = await DB.getItem(parentfolder);
  if ( !parent || parent.type !== 'folder' ) {
    res.status(404);
    return next(`parentfolder ${parentfolder} not exists`);
  }

  let path = await FSApiLib.buildPath(parent);

  // request.socket.setKeepAlive(true);
  // request.socket.setTimeout(1000 * 60 * 60 * 1); // 1 hours
  // request.setTimeout(1000 * 60 * 60 * 1);

  // res.connection.setTimeout(0);

  const Form = new Multiparty.Form();

  Form.on('part', (part) => {
    if (part.filename !== undefined) {
      cb(part)
    }
  });

  Form.on('close', function() {
    Log.debug('finish receiving file!');
  });

  Form.parse(request);

  const cb = async (file) => {
    
    if ( !file ) {
      res.status(422);
      return next(`file is missing`);
    }

    let {filename: fn} = file;

    fn = filename || fn;

    if ( !fn ) {
      res.status(422);
      return next(`filename is missing`);
    }

    path += `/${fn}`;

    try {

      const service = await FSApi.createFileWithContent(path.toString(), file, (dbFile) => {
        return res.status(201).send(`file correctly created: ${dbFile.id}`);
      });

      if ( service ) {

        request.on('error', () => {
          if ( !service.aborted ) {
            service.stop();
            Log.warn('request has been aborted because of error');
          } 
        });
      
        request.on('aborted', () => {
          if ( !service.aborted ) {
            service.stop();
            Log.warn('request has been aborted because of aborted');
          } 
        });
      
        request.on('close', () => {
          // Once upload is completed, request is being closed, but we need to continue uploading on telegram
          // so we don't have to abort the process in this case
          Log.info('request has been closed. Do not abort the process');
        });

        await service.execute(file);
      }


    } catch(e) {
      Log.error(e);
      res.status(422);
      next(`cannot create file`);
    }
  }
});

App.post('/folder/:fldid/folder/:foldername', async function (request, res, next) {
  let {fldid: parentfolder, foldername} = request.params;

  if ( !foldername ) {
    res.status(422);
    return next('foldername is missing');
  }

  if ( !parentfolder ) {
    res.status(422);
    return next('parentfolder must be specified');
  }

  if ( !DB.isUUID(parentfolder) ) {
    res.status(422);
    return next('parentfolder id mismsatch');
  }

  const parent = await DB.getItem(parentfolder);
  if ( !parent || parent.type !== 'folder' ) {
    res.status(404);
    return next(`parentfolder ${parentfolder} not exists`);
  }

  let path = await FSApiLib.buildPath(parent);

  path += `/${foldername}`;

  const dbFile = await FSApi.create(path.toString(), true);

  res.status(201)
  res.send(`folder created: ${dbFile.id}`);

});

App.put('/file/:fileid', async function (request, res, next) {
  // HANDLE rename/move file
  return next('cannot handle yet');
});

App.put('/folder/:fldid', async function (request, res, next) {
  // HANDLE rename/move folder
  return next('cannot handle yet');
});

App.delete('/file/:fileid', async function (request, res, next) {

  if ( !request.params.fileid ) {
    res.status(422);
    return next({error: 'invalid file id'});
  }

  const file = await DB.getItem( request.params.fileid );

  if ( !file || file.type == 'folder' ) {
    res.status(422);
    return next({error: `file not found with id ${request.params.fileid}`});
  }

  try {
    const path = await FSApiLib.buildPath(file);

    await FSApi.delete(path.toString());

    res.status(204);
    res.send(`file deleted!`);

  } catch(e) {
    Log.error(e);
    res.status(422);
    next(`cannot delete file`);
  }
});

App.delete('/folder/:fldId', async function (request, res, next) {

  const {fldId} = request.params;

  if ( !fldId ) {
    res.status(422);
    return next({error: 'invalid folder id'});
  }

  const folder = await DB.getItem(fldId);
  if ( !folder || folder.type !== 'folder' ) {
    res.status(422);
    return next({error: `item ${fldId} is not a folder`});
  }

  const path = await FSApiLib.buildPath(folder);

  try {

    await FSApi.delete(path.toString(), true);

    res.status(204);
    res.send(`folder has been correctly deleted`);

  } catch(e) {
    Log.error(e);
    res.status(422);
    res.send(`cannot delete folder with id ${fldId}`);
  }
});

App.use((err, req, res, next) => {
  Log.error(err.stack)
  res.status(500).send(err);
});


const svr = App.listen(Config.http.port, Config.http.host, async (err) => {
  Log.info('application is listening:', Config.http.host, 'on port', Config.http.port);
  
  const rootFolder = await DB.getItem( ROOT_ID );
  FSApi = new FSApiLib( rootFolder );
  
  if (err) {
    Log.error(err);
    throw err
  }
});
svr.requestTimeout = 0;
svr.headersTimeout = 0;