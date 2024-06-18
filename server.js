const {parseRange} = require('./utils');
const { PassThrough } = require('stream');
const Streamer = require('./services/streamer');
const TelegramClients = require('./services/clients');
const Logger = require('./logger');
const {Config} = require('./config');

const Log = new Logger('Server');

const {getItem} = require('./services/databases');

const Fastify = require('fastify')({
  // logger: true
});


Fastify.get('/dwl/:dbid', function (request, reply) {
  // GET data from DB
  Log.info(`[${request.id}]`, 'new request for', req.params.dbid, 'with range:', request.headers.range);

  const file = getItem(request.params.dbid);

  if ( !file ) {
    Log.error('no file found with id', request.params.dbid);
    reply.code(404);
    return reply.send(`cannot find file with id: ${request.params.id}`);
  }

  if ( file.type == 'folder' ) {
    Log.error(`file ${request.params.dbid} is a folder`);
    reply.code(426);
    return reply.send(`file ${request.params.dbid} is a folder`);
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
  const service = new Streamer(request.id, dbData, start, end);

  request.raw.on('error', () => {
    if ( !service.aborted ) {
      service.stop();
      Log.warn('request has been aborted because of error')
    } 
  })

  request.raw.on('aborted', () => {
    if ( !service.aborted ) {
      service.stop();
      Log.warn('request has been aborted because of aborted')
    } 
  })

  request.raw.on('close', () => {
    if ( !service.aborted ) {
      service.stop();
      Log.warn('request has been aborted because of close')
    } 
  })

  reply.code( headerRange ? 206 : 200)
      
  reply.header('Content-Range', `bytes ${start}-${end}/${totalsize}`);
  reply.header('content-length', (end - start) + 1);
  reply.header('content-type', 'video/x-matroska');
  reply.header("content-disposition", `inline; filename="${file.filename}"`);
  reply.header("accept-ranges", "bytes");

  reply.send(stream);

  TelegramClients.nextClient();
  const client = TelegramClients.Client;
  service.execute(client, stream);

  Log.info(`[${request.id}]`, 'responded');
  Log.debug(reply.getHeaders());

});



Fastify.listen({ port: Config.httpPort }, (err, address) => {
  Log.info('application is listening:', address, 'on port', Config.httpPort)
  if (err) {
    throw err
  }
})