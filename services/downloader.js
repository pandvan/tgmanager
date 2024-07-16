/**
 * Get the file associated with given message_id 
 * and start downloading it.
 * File could be split in more than one file, so
 * we have to get the right piece of file and download via `range request`.
 * User can choose to download 'entire original file' or 'single part' or 'a portion of file'.
 * File parts could be located in different channel. 
 * Keep in mind: user must have full access of channel in order to download files
 * 
 * Example of input data:
 * 
 * type FilePartData = {
 *   ch: string;    // telegram channel_id which contains file part (last 10 numbers, absolute number)
 *   msg: number;   // telegram message_id associated to the file part
 *   size: number   // size of the file part in bytes
 * }
 * 
 * const DATA : FilePartData[] = [
 *   {
 *     ch: 'xxxxx',        
 *     msg: 1,             
 *     size: 459578337
 *   }, {
 *     ch: 'xxxxx',
 *     msg: 2,
 *     size: 452920795
 *   }, {
 *     ch: 'yyyyy',
 *     msg: 3,
 *     size: 4529207
 *   }, {
 *     ch: 'yyyyyy',
 *     msg: 4,
 *     size: 4529207
 *   }
 * ];
 * 
 */

const { UPLOAD_CHUNK } = require('../config');
const Logger = require('../logger');

const Log = new Logger('Downloader');

class Downloader {

  /* if true stops downloading */
  aborted = false;
  
  /* total size of file */
  totalsize = 0;

  /* range of bytes to be downloaded */
  range = null;

  client = null;

  /**
   * constructor
   * @param {string} id: the unique identifier of task
   * @param {FilePartData[]} data: data to be processed (FilePartData: see above comments)
   * @param {number} start: the start range
   * @param {number} end: the end range
   */
  constructor(client, data, start, end) {
    this.data = data;
    this.range = {
      start, end
    };
    this.totalsize = this.data.reduce((acc, curr) => acc + curr.size, 0);
    this.client = client;
  }


  get Range() {
    return {
      ...this.range,
      totalsize: this.totalsize
    }
  }

  /**
   * Stop downloading
   */
  stop() {
    Log.warn('aborted');
    this.aborted = true;
  }

  /**
   * @param {Stream} destination: the destination stream
   */
  async execute(destination) {

    const files = [];

    let currentSizePosition = 0;
    let currentIndex = 0;

    // Calculate the full range stack to be downloaded
    while( true ) {

      const file = this.data[currentIndex];
      let fileToAdd = null;

      if ( this.range.start < (currentSizePosition + file.size) ) {
        // found first chunk of file part to add to download queue
        fileToAdd = {
          index: currentIndex,
          file,
          start:  files.length == 0 ? this.range.start - currentSizePosition : 0
        };

        if ( this.range.end <= (currentSizePosition + file.size) ) {
          
          fileToAdd.end = file.size - ( (currentSizePosition + file.size) - this.range.end ) + 1;
          files.push(fileToAdd);
          break;

        } else {
          
          fileToAdd.end = file.size;
          files.push(fileToAdd);

        }
      }

      currentSizePosition += file.size;

      currentIndex++;
    }

    destination.setDefaultHighWaterMark(false, UPLOAD_CHUNK * 2);
    destination.resume();
    let tgChannel = null;

    for await (const item of files) {

      const {start, end, file} = item;
      const {ch, msg} = file;
      
      if ( !tgChannel || tgChannel.id !== ch) {
        Log.debug('getting channel', ch);
        tgChannel = await this.client.getChannel( ch );
      }
  
      Log.debug('getting message', msg);
      const message = await this.client.getMessage({id: tgChannel.id, hash: tgChannel.access_hash}, msg);
      const {media} = message;
      const {document} = media;
      const {id, access_hash, file_reference} = document;
  
      Log.debug('ready for download, range:', `${start}-${end}`);
      await this.performStream({id, access_hash, file_reference}, start, end, destination);

      if ( this.aborted ) {
        break;
      }
  
    }

    // close stream
    destination.end();
  }


  /**
   * 
   * @param {string} id: the telegram file_id
   * @param {number} start: the start range
   * @param {number} end: the end range 
   * @param {Stream} stream: destination stream
   */
  async performStream({id, access_hash, file_reference}, start, end, stream) {

    // telegram chunk (1MB)
    const CHUNK = 1 * 1024 * 1024;
  
    // calculate the start offset of download
    let offset = start - (start % CHUNK);
    let first = true;
  
    let needStop = false;

    Log.debug('stream from', start, end);
  
    while(true) {
      // Log.debug(`[${this.id}]`, 'get file from telegram', offset);
      const tgFile = await this.client.getFile({id, access_hash, file_reference}, offset, CHUNK);
  
      let firstByte = 0;
      let lastByte = CHUNK;
  
      if ( first ) {
        firstByte = start - offset;
        first = false;
      }
  
      if ( offset + tgFile.bytes.length >= end ) {
        lastByte = end - offset;
        needStop = true
      }
  
      const buf = Uint8Array.prototype.slice.call(tgFile.bytes, firstByte, lastByte);
      // Log.debug(`[${this.id}]`, 'write', buf.length);
      stream.write( buf );
  
      offset += CHUNK;
  
      if ( needStop || this.aborted ) { 
        break
      }
    }
  
  }

}



module.exports = Downloader;