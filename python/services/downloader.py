from services.telegram import TelegramApi
from services.database import TGFile
from configuration import UPLOAD_CHUNK
import logging

Log = logging.getLogger('Downloader')


class Downloader():
  
  aborted = False

  client = None
  channel_id = None
  parts = None
  range_start = 0
  range_end = -1
  totalsize = 0
  file = None

  def __init__(self, client: TelegramApi, file: TGFile, start: int, end: int):
    self.client = client
    self.channel_id = file.channel
    self.file = file
    self.parts = file.parts
    self.range_start = start
    self.range_end = end

    self.totalsize = 0

    for part in file.parts:
      self.totalsize += part.size
    
  
  def stop(self):
    self.aborted = True
  

  async def execute(self, destination, awaited = True):

    files = []

    currentSizePosition = 0
    currentIndex = 0

    if self.file and self.file.content is not None and self.file.content_length():
      if awaited:
        await destination.write( file.content )
      else:
        destination.write( file.content )
      
      try:
        if awaited:
          await destination.write_eof()
        else:
          destination.write_eof()
      except Exception:
        Log.warn(f"cannot write_eof")
      
      return

    # Calculate the full range stack to be downloaded
    while( True ):

      file = self.parts[currentIndex]
      fileToAdd = None

      if ( self.range_start < (currentSizePosition + file.size) ):
        # found first chunk of file part to add to download queue
        fileToAdd = {
          'index': currentIndex,
          'file': file,
          'start': self.range_start - currentSizePosition if len(files) == 0 else 0
        }

        if ( self.range_end <= (currentSizePosition + file.size) ):
          
          fileToAdd['end'] = file.size - ( (currentSizePosition + file.size) - self.range_end ) + 1
          files.append(fileToAdd)
          break

        else:
          fileToAdd['end'] = file.size
          files.append(fileToAdd)
      
      currentSizePosition += file.size
      currentIndex += 1
    
    
    for item in files:

      start = item['start']
      end = item['end']
      file = item['file']
      msg = file.messageid
      
      Log.debug(f"getting message {msg}")
      message = await self.client.get_message(self.channel_id, msg)
      media = TelegramApi.get_media_from_message( message )
  
      Log.debug(f"ready for download, range: {start}-${end}")

      await self.perform_stream(media.filedata.media_id, media.filedata.access_hash, media.filedata.file_reference, None, start, end, destination, awaited)

      if ( self.aborted ):
        break
    
    try:
      await destination.write_eof()    
    except Exception:
      Log.warn(f"cannot write_eof")

  
  async def perform_stream(self, id, hash, reference, dc, start, end, destination, awaited = True):
    # telegram chunk (1MB)
    CHUNK = UPLOAD_CHUNK * 2 # 1 Mb
  
    # calculate the start offset of download
    offset = start - (start % CHUNK)
    first = True
  
    needStop = False

    Log.debug(f"stream from {start} to {end}");

    while (True):
      tgFile = await self.client.get_file(id, hash, reference, offset, CHUNK)
  
      firstByte = 0
      lastByte = CHUNK
  
      if ( first ):
        firstByte = start - offset
        first = False
  
      if ( offset + len(tgFile.bytes) >= end ):
        lastByte = end - offset
        needStop = True
  
      buf = tgFile.bytes[firstByte : lastByte]
      if awaited:
        resp = await destination.write( buf )
      else:
        resp = destination.write( buf )
      Log.debug(f"wrote {len(buf) == resp}, {len(buf)} bytes")

      offset += CHUNK
  
      if ( needStop or self.aborted ):
        break