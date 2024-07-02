const {parseRange} = require('./utils');
const Stream = require('stream');
const TelegramClients = require('./services/clients');
const Logger = require('./logger');
const {Config} = require('./config');
const Multipart = require('@fastify/multipart');
const Mime = require('mime-types');
const Pug = require('pug');
const Path = require('path');
const FastifyView = require('@fastify/view');
const DB = require('./services/databases');
const FastifyStatic = require('@fastify/static');

const FSApiLib = require('./services/fs-api');

const Log = new Logger('Server');

let FSApi = null;

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

  const folder = await DB.getItem(fldId);
  if ( !folder || folder.type !== 'folder' ) {
    reply.code(422);
    return reply.send({error: `item ${fldId} is not a folder`});
  }

  const paths = await FSApi.buildPath(folder);
  const children = await FSApi.listDir(paths);

  return reply.send( children.slice(1) );
});

Fastify.get('/files/:fileid', async function (request, reply) {
  // GET data from DB
  Log.info(`[${request.id}]`, 'new request for', request.params.dbid, 'with range:', request.headers.range);

  if ( !request.params.fileid ) {
    reply.code(422);
    return reply.send({error: 'invalid file id'});
  }

  const file = await DB.getItem( request.params.fileid );

  if ( !file || file.type == 'folder' ) {
    reply.code(422);
    return reply.send({error: `file not found with id ${request.params.fileid}`});
  }

  const stream = new Stream.PassThrough();
  stream.pause();

  // parse Range header 
  const headerRange = request.headers['range'];
  const range = headerRange || '';
  let {start, end} = parseRange(range);

  const path = await FSApi.buildPath(file);

  let totalsize = file.parts.reduce((acc, curr) => acc + curr.size, 0);

  if ( isNaN(start) ) {
    start = 0;
  }

  if ( isNaN(end) ) {
    end = totalsize - 1;
  }

  const service = await FSApi.readFileContent(path.toString(), {start, end}, stream);

  if ( service ) {
    // file will be read from telegram

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

  }

  reply.code( headerRange ? 206 : 200);
      
  reply.header('Content-Range', `bytes ${start}-${end}/${totalsize}`);
  reply.header('content-length', (end - start) + 1);
  reply.header('content-type', file.type);
  reply.header("content-disposition", `inline; filename="${file.filename}"`);
  reply.header("accept-ranges", "bytes");

  reply.send(stream);
  stream.resume();

  await reply;
});

Fastify.post('/folder/:fldid/file/:filename?', async function (request, reply) {

  const {fldid: parentfolder, filename} = request.params;

  if ( !parentfolder) {
    reply.code(422);
    return await reply.send('parentfolder must be specified');
  }

  if ( !DB.isUUID(parentfolder) ) {
    reply.code(422);
    return await reply.send('parentfolder id mismsatch');
  }

  const parent = await DB.getItem(parentfolder);
  if ( !parent || parent.type !== 'folder' ) {
    reply.code(404);
    return await reply.send(`parentfolder ${parentfolder} not exists`);
  }

  let path = await FSApi.buildPath(parent);

  let file = await request.file();
  
  if ( !file ) {
    reply.code(422);
    return await reply.send(`file is missing`);
  }

  let {filename: fn} = file;

  fn = filename || fn;

  if ( !fn ) {
    reply.code(422);
    return await reply.send(`filename is missing`);
  }

  path += `/${fn}`;

  try {

    const service = await FSApi.createFileWithContent(path.toString(), file.file, (dbFile) => {
      return reply.code(201).send(`file correctly created: ${dbFile.id}`);
    });

    request.raw.on('error', () => {
      if ( !service.aborted ) {
        service.stop();
        Log.warn('request has been aborted because of error');
      } 
    });
  
    request.raw.on('aborted', () => {
      if ( !service.aborted ) {
        service.stop();
        Log.warn('request has been aborted because of aborted');
      } 
    });
  
    request.raw.on('close', () => {
      if ( !service.aborted ) {
        service.stop();
        Log.warn('request has been aborted because of close');
      } 
    });


  } catch(e) {
    Log.error(e);
    reply.code(422).send(`cannot create file`);
  }

  await reply;
});

Fastify.post('/folder/:fldid/folder/:foldername', async function (request, reply) {
  let {fldid: parentfolder, foldername} = request.params;

  if ( !foldername ) {
    reply.code(422);
    return await reply.send('foldername is missing');
  }

  if ( !parentfolder ) {
    reply.code(422);
    return await reply.send('parentfolder must be specified');
  }

  if ( !DB.isUUID(parentfolder) ) {
    reply.code(422);
    return await reply.send('parentfolder id mismsatch');
  }

  const parent = await DB.getItem(parentfolder);
  if ( !parent || parent.type !== 'folder' ) {
    reply.code(404);
    return await reply.send(`parentfolder ${parentfolder} not exists`);
  }

  let path = await FSApi.buildPath(parent);

  path += `/${foldername}`;

  const dbFile = await FSApi.create(path.toString(), true);

  reply.code(201).send(`folder created: ${dbFile.id}`);

});

Fastify.put('/file/:fileid', async function (request, reply) {
  // HANDLE rename/move file
  return reply.send('cannot handle yet');
});

Fastify.put('/folder/:fldid', async function (request, reply) {
  // HANDLE rename/move folder
  return reply.send('cannot handle yet');
});

Fastify.delete('/file/:fileid', async function (request, reply) {

  if ( !request.params.fileid ) {
    reply.code(422);
    return reply.send({error: 'invalid file id'});
  }

  const file = await DB.getItem( request.params.fileid );

  if ( !file || file.type == 'folder' ) {
    reply.code(422);
    return reply.send({error: `file not found with id ${request.params.fileid}`});
  }

  try {
    const path = await FSApi.buildPath(file);

    await FSApi.delete(path.toString());

    await reply.code(204).send(`file deleted!`);

  } catch(e) {
    Log.error(e);
    await reply.code(422).send(`cannot delete file`);
  }
});

Fastify.delete('/folder/:fldId', async function (request, reply) {

  const {fldId} = request.params;

  if ( !fldId ) {
    reply.code(422);
    return reply.send({error: 'invalid folder id'});
  }

  const folder = await DB.getItem(fldId);
  if ( !folder || folder.type !== 'folder' ) {
    reply.code(422);
    return reply.send({error: `item ${fldId} is not a folder`});
  }

  const path = await FSApi.buildPath(folder);

  try {

    await FSApi.delete(path.toString(), true);

    await reply.code(204).send(`folder has been correctly deleted`);

  } catch(e) {
    Log.error(e);
    await reply.code(422).send(`cannot delete folder with id ${fldId}`);
  }
});


Fastify.listen({ port: Config.httpPort }, async (err, address) => {
  Log.info('application is listening:', address, 'on port', Config.httpPort);
  
  const rootFolder = await DB.getItem( DB.ROOT_ID );
  FSApi = new FSApiLib( rootFolder );
  
  if (err) {
    throw err
  }
})