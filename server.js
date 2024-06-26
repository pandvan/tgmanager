const {parseRange, isUUID} = require('./utils');
const { PassThrough } = require('stream');
const Downloader = require('./services/downloader');
const TelegramClients = require('./services/clients');
const Logger = require('./logger');
const {Config} = require('./config');
const Uploader = require('./services/uploader');
const Multipart = require('@fastify/multipart');
const Mime = require('mime-types');
const Pug = require('pug');
const Path = require('path');
const FastifyView = require('@fastify/view');
const {getItem, ROOT_ID, getItemByFilename, saveFile, writeSync, removeItem, getChildren} = require('./services/databases');
const FastifyStatic = require('@fastify/static');

const Log = new Logger('Server');

const Fastify = require('fastify')({
  // logger: true
});

if ( Config.basic_auth ) {
  Fastify.register(require('@fastify/basic-auth'), {
    validate: (username, password, req, reply, done) => {
      if (username === Config.basic_auth.user && password === Config.basic_auth.pass ) {
        done();
      } else {
        done(new Error('Invalid authentication'))
      }
    },
    authenticate: true // WWW-Authenticate: Basic
  });

  Fastify.after(() => {
    Fastify.addHook('onRequest', Fastify.basicAuth)
  });
}

Fastify.register(FastifyView, {
  engine: {
    pug: Pug
  }
});

Fastify.register(FastifyStatic, {
  root: Path.join(__dirname, 'public'),
  prefix: '/public/', // optional: default '/'
})

Fastify.register( Multipart, { limits: {fileSize: Infinity } } );

Fastify.get("/", (req, reply) => {
  reply.view("webUI/index.pug");
});

Fastify.get('/folder/:fldId', async (request, reply) => {

  const {fldId} = request.params;

  if ( !fldId ) {
    reply.code(422);
    return reply.send({error: 'invalid folder id'});
  }

  const folder = await getItem(fldId);
  if ( folder.type !== 'folder' ) {
    reply.code(422);
    return reply.send({error: `item ${fldId} is not a folder`});
  }

  const children = await getChildren(folder.id);

  return reply.send( children );
});

Fastify.get('/dwl/:fileid', async function (request, reply) {
  // GET data from DB
  Log.info(`[${request.id}]`, 'new request for', request.params.dbid, 'with range:', request.headers.range);

  const file = await getItem(request.params.fileid);

  if ( !file ) {
    Log.error('no file found with id', request.params.fileid);
    reply.code(404);
    return reply.send(`cannot find file with id: ${request.params.id}`);
  }

  if ( file.type == 'folder' ) {
    Log.error(`file ${request.params.fileid} is a folder`);
    reply.code(426);
    return reply.send(`file ${request.params.fileid} is a folder`);
  }

  const dbData = [];
  for ( const [i, msgid] of file.parts.entries() ) {

    dbData.push({
      ch: String(file.channel).length > 10 ? String(file.channel).substring(3) : String(file.channel),
      msg: msgid,
      size: file.sizes[ i ]
    });

  }

  // parse Range header 
  const headerRange = request.headers['range'];
  const range = headerRange || '';
  let {start, end} = parseRange(range);

  const totalsize = dbData.reduce((acc, curr) => acc + curr.size, 0);

  if ( isNaN(start) ) {
    start = 0;
  }

  if ( isNaN(end) ) {
    end = totalsize - 1;
  }

  const stream = new PassThrough();
  stream.on('data', (c) => Log.debug(`[${request.id}]`, 'sending', c.length));
  const service = new Downloader(request.id, dbData, start, end);

  request.raw.on('error', () => {
    if ( !service.aborted ) {
      service.stop();
      Log.warn('request has been aborted because of error')
    } 
  });

  request.raw.on('aborted', () => {
    if ( !service.aborted ) {
      service.stop();
      Log.warn('request has been aborted because of aborted')
    } 
  });

  request.raw.on('close', () => {
    if ( !service.aborted ) {
      service.stop();
      Log.warn('request has been aborted because of close')
    } 
  });

  reply.code( headerRange ? 206 : 200)
      
  reply.header('Content-Range', `bytes ${start}-${end}/${totalsize}`);
  reply.header('content-length', (end - start) + 1);
  reply.header('content-type', file.type);
  reply.header("content-disposition", `inline; filename="${file.filename}"`);
  reply.header("accept-ranges", "bytes");

  reply.send(stream);

  TelegramClients.nextClient();
  const client = TelegramClients.Client;
  service.execute(client, stream);

  Log.info(`[${request.id}]`, 'responded');
  Log.debug(reply.getHeaders());

  await reply;

});

Fastify.post('/fld/:fldid/file', async function (request, reply) {


  let parentfolder = request.params.fldid;

  if ( !parentfolder) {
    reply.code(422);
    return await reply.send('parentfolder must be specified');
  }

  if ( !isUUID(parentfolder) ) {
    reply.code(422);
    return await reply.send('invalid parentfolder');
  }

  const parent = await getItem(parentfolder);
  if ( !parent ) {
    reply.code(404);
    return await reply.send(`parentfolder ${parentfolder} not exists`);
  }

  let channelid = null, p = parent;
  while ( !channelid ) {
    p = await getItem(p.id);
    channelid = p.channel;
    if (p.id === ROOT_ID) break;
    p = p.parentfolder;
  }

  if ( !channelid ) {
    Log.info('file will be uploaded into default channel');
  }

  let file = await request.file();
  
  if ( !file ) {
    reply.code(422);
    return await reply.send(`file is missing`);
  }

  let {mimetype, filename} = file;

  mimetype = Mime.lookup(filename) || mimetype;

  const f = await getItemByFilename(filename, parent.id);
  if ( f && f.state == 'TEMP' ) {
    Log.warn('delete already existing TEMPORARY file', filename, 'in', parent.filename);
    await removeItem(f.id);
  }

  const dbFile = await saveFile({
    filename: filename,
    originalFilename: filename,
    type: mimetype,
    // md5: 'string?',
    // fileids: 'string[]',
    // sizes: 'double[]',
    // info: 'string{}',
    // content: 'data?',
    state: 'TEMP'
  }, parentfolder);


  TelegramClients.nextClient();
  const client = TelegramClients.Client;

  const uploader = new Uploader(client, channelid, filename);

  await uploader.prepare();

  uploader.onCompleteUpload = async (portions, chl) => {
    writeSync( () => {
      dbFile.channel = chl;
      dbFile.fileids = portions.map( (item) => item.fileId );
      dbFile.sizes = portions.map( (item) => item.size );
      dbFile.parts = portions.map( (item) => item.msgid );

      dbFile.state = 'ACTIVE';

      Log.info('file has been correctly uploaded, id: ', dbFile.id);

      return reply.send('file is being upload');
    });
  };

  Log.info('file is being uplaoded, id:', dbFile.id);
  await uploader.execute(file.file);

});

Fastify.post('/folder', async function (request, reply) {
  // HANDLE create folder
  return reply.send('cannot handle yet');
});

Fastify.put('/file/:id', async function (request, reply) {
  // HANDLE rename/move file
  return reply.send('cannot handle yet');
});

Fastify.put('/folder/:id', async function (request, reply) {
  // HANDLE rename/move folder
  return reply.send('cannot handle yet');
});

Fastify.delete('/file/:id', async function (request, reply) {
  // HANDLE delete file
  return reply.send('cannot handle yet');
});

Fastify.delete('/folder/:id', async function (request, reply) {
  // HANDLE delete folder
  return reply.send('cannot handle yet');
});


Fastify.listen({ port: Config.httpPort }, (err, address) => {
  Log.info('application is listening:', address, 'on port', Config.httpPort)
  if (err) {
    throw err
  }
})