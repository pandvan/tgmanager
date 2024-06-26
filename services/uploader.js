const ShortUniqueID = require('short-unique-id');
const {Config} = require('../config');
const Mime = require('mime-types');

const UUID = new ShortUniqueID({dictionary: 'number', length: 19});

const CHUNK = 512 * 1024; // 1KB

class Uploader {
  aborted = false;

  client = null;
  channelId = null;
  totalFileParts = [];
  filename = '';
  currentFilePartIndex = -1;
  _onPortionUploaded = null;
  _onCompleteUpload = null;
  tgChannel = null;


  set onPortionUploaded(callback) {
    this._onPortionUploaded = callback;
  }
  
  set onCompleteUpload(callback) {
    this._onCompleteUpload = callback;
  }

  constructor(client, channelId, filename) {

    this.client = client;
    this.filename = filename;
    this.channelId = channelId || Config.telegram.upload.channel;

  }

  async prepare() {
    const channel = await this.client.getChannel( this.channelId );
    this.tgChannel = {
      id: channel.id,
      hash: channel.access_hash
    }
  }

  async execute(source) {

    this.currentFilePartIndex = 0;

    let buf = null;

    this.newPortionFile();

    source.on('data', async (chunk) => {
      if (buf) {
        buf = Buffer.concat([buf, chunk]);
      } else {
        buf = chunk;
      }
  
      const uploadChunk = Uint8Array.prototype.slice.call(buf, 0, CHUNK);
  
      if ( uploadChunk.length < CHUNK ) {
        // wait for next chunk, or it could be complted (see 'end' event handler)
        return;
      }
      
      buf = Uint8Array.prototype.slice.call(buf, CHUNK);


      await this.uploadChunk(uploadChunk);

    });

    source.on('finish', async () => {

      const uploadChunk = Uint8Array.prototype.slice.call(buf, 0, CHUNK);
      if ( uploadChunk.length ) {
        
        await this.uploadChunk(uploadChunk, true);
      }

      if ( this._onCompleteUpload ) {
        await this._onCompleteUpload(this.totalFileParts, this.channelId);
      }

    });

    // force resume stream
    source.resume();
  }

  getCurrentPortion() {
    return this.totalFileParts[this.currentFilePartIndex];
  }

  newPortionFile() {
    this.currentFilePartIndex = this.totalFileParts.push({
      index: this.totalFileParts.length,
      fileId: Number(UUID.randomUUID()),
      currentPart: -1,
      mime: Mime.lookup(this.filename) || 'application/octet-stream',
      filename: this.filename,
      msgid: null,
      size: 0
    }) - 1;
    return this.totalFileParts[ this.currentFilePartIndex ];
  }


  async uploadChunk(buffer, lastChunk) {
    const {maxUploadParts} = this.client.Login;
    let currentPortion = this.getCurrentPortion();

    if ( !currentPortion ) {
      currentPortion = this.newPortionFile();
    }

    currentPortion.currentPart += 1;

    const sendToChannel = currentPortion.currentPart == maxUploadParts;


    if ( sendToChannel ) {
      // handle next portion of file
      this.currentFilePartIndex++;
    }

    currentPortion.size += buffer.byteLength;

    await this.client.sendFileParts(
      currentPortion.fileId,
      currentPortion.currentPart,
      (sendToChannel || lastChunk ? Math.ceil(currentPortion.size / CHUNK) : -1),
      buffer,
    );

    if ( sendToChannel || lastChunk ) {
      await this.sendToChannel(currentPortion);
    }
    
  }


  async sendToChannel(portion) {
    let {filename} = portion; 

    if ( this.totalFileParts.length > 1 ) {
      filename = `${filename}.${ ('000' + String(portion.index + 1)).slice( -3 ) }`;
    }

    const res = await this.client.moveFileToChat(
      this.tgChannel ? {
        id: this.tgChannel.id,
        hash: this.tgChannel.hash
      } : null,
      {
        fileId: portion.fileId,
        parts: Math.ceil(portion.size / CHUNK),
        filename: filename,
        mime: portion.mime
      }
    );

    const {message} = res.updates.find( (u) => !!u.message );
    portion.msgid = message.id;
    portion.fileId = message.media.document.id;

    if ( this._onPortionUploaded ) {
      await this._onPortionUploaded(portion);
    }

  }

}


module.exports = Uploader;