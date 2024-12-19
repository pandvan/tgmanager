from services.telegram import TelegramApi
from services.database import TGFile, TGFolder, TGPart, getItemByFilename, create_folder, start_session, create_file, update_file
from services.tgclients import TGClients
from utils import get_item_channel
import time
import logging

Log = logging.getLogger('CopyBatch')

class CopyBatch():
  
  aborted = False
  destinationRootFolder = None
  batch = 10
  timeout = 1

  current_operation_index = 0

  def __init__(self, destination: TGFolder, batch = 10, timeout = 1):
    self.destinationRootFolder = destination
    self.batch = batch
    self.timeout = timeout

  def stop(self):
    self.aborted = True
  

  async def execute(self):
    pass

  
  async def process(self, sources: list[TGFile]):

    client = TGClients.next_client()

    total_processed_file = 0
    total_forwarded_file = 0

    for source in sources:
      
      try:
        Log.info(f"processing '{source.filename}'")
        newfile, has_been_forwarded_file = await self.process_item(client, source)

        Log.info(f"'{newfile.filename}' has been correctly processed")

        total_processed_file = total_processed_file + 1

        if has_been_forwarded_file:
          # operation on telegram: calculate batch and timer for pause
          total_forwarded_file = total_forwarded_file + 1

        if total_forwarded_file % self.batch == 0:
          Log.info(f"pause {self.timeout}s after {self.batch} files")
          time.sleep( self.timeout )
          client = TGClients.next_client()
      except Exception as E:
        Log.error(f"file: '{source.filename}' got errors", exc_info=True)
        pass
    

    Log.info(f"Completed: {total_processed_file} / {len(sources)} file correctly processed")
    return total_processed_file


  async def process_item(self, client: TelegramApi, source: TGFile, session= None):

    has_been_forwarded_file = False

    sourcePath = source.path
    destFolder = self.destinationRootFolder

    start_creating_folder = False
    for folder in sourcePath:
      if start_creating_folder:

        existsFolder = getItemByFilename( folder.filename, destFolder.id, 'folder')
        if existsFolder is None:
          # create folder
          Log.debug(f"creating folder '{folder.filename}' in '{destFolder.filename}'")
          destFolder = create_folder(TGFolder(
            filename = folder.filename,
            channel = folder.channel,
            parentfolder = destFolder.id
          ))
          continue
        else:
          destFolder = existsFolder
      if folder.id == source.parentfolder:
        start_creating_folder = True



    # check file already exists
    exists_file = getItemByFilename( source.filename, destFolder.id )
    if exists_file:
      Log.debug(f"file '{source.filename}' already exists in destination folder '{destFolder.filename}' [{destFolder.id}]")
      raise Exception(f"file {source.filename} already exists in destination")


    # calculate source and dest channel
    source_channel = get_item_channel(source, False)
    dest_channel = get_item_channel(destFolder, False)

    parts = None

    (session, transaction) = start_session()

    with transaction:

      # prepare new file to be saved into DB
      newdata = source.clone()
      newdata.state = 'TEMP'
      newdata.id = None

      # try to create new file (check exists)
      Log.debug(f"creating TEMP file '{newdata.filename}'")
      newFileData = create_file(newdata, destFolder.id, session= session)

      if source.is_on_telegram():
        # file is on telegram
        newparts = newFileData.parts

        if dest_channel and source_channel != dest_channel:
          # move file on telegram
          newparts = await self.forward_file_between_channels(client, newFileData, source_channel, dest_channel)
          has_been_forwarded_file = True

        newFileData.parts = newparts
        newFileData.channel = dest_channel or source_channel
        newFileData.content = None
        
      
      else:
        # file is on local db, just copy file
        newFileData.parts = None
        newFileData.channel = dest_channel or source_channel

        # content has been already copied (just to be sure)
        newFileData.content = source.content
      
      # file has been processed: set 'ACTIVE'
      newFileData.state = 'ACTIVE'
      
      update_file(newdata, newFileData, destFolder.id, session)
    
    # delete original file parts because of `move`
    # if delete_original:
    #   for part in source.parts:
    #     resp = await client.delete_message(source.channel, part.messageid)
    #     if resp.pts_count != 1:
    #       raise Exception(f"More than one message has been deleted")
    
      
    return newFileData, has_been_forwarded_file



  async def forward_file_between_channels(self, client: TelegramApi, source: TGFile, source_channel, dest_channel):

    Log.debug(f"try to forward file parts from '{source_channel}' to '{dest_channel}'")
    newParts = []
    for part in source.parts:
      message = await client.get_message(source_channel, part.messageid)
      if message:
        media = TelegramApi.get_media_from_message(message)
        if str(part.fileid) == str(media.filedata.media_id):
          newmessage = await client.copy_message(source_channel, dest_channel, part.messageid)
          newmedia = TelegramApi.get_media_from_message(newmessage)
          newpart = TGPart(
            messageid= newmessage.id,
            hash= part.hash,
            fileid= newmedia.filedata.media_id,
            originalfilename = part.originalfilename,
            size= newmedia.file_size,
            index= part.index
          )
          # for attr in newmedia.document.attributes:
          #   if attr.QUALNAME == 'types.DocumentAttributeFilename':
          #     newpart.originalfilename = attr.file_name
          #     Log.debug(f"tg-filename: {newpart.originalfilename}")
          #     break
              
          newParts.append(newpart)
          break
          
        # pause after X operations
        self.current_operation_index = self.current_operation_index + 1
        if self.current_operation_index % self.batch == 0:
          Log.info(f"pause {self.timeout}s after {self.batch} operations")
          time.sleep( self.timeout )
        
        else: 
          Log.warning(f"file_id is different: {str(part.fileid)} - {str(media.filedata.media_id)}, channel: {source_channel}, message: {part.messageid}")
          raise Exception(f"file_id is different: {str(part.fileid)} - {str(media.filedata.media_id)}, channel: {source_channel}, message: {part.messageid}")
      else:
        Log.warning(f"cannot get message from channel: {source_channel} -> {part.messageid}")
        raise Exception(f"cannot get message from channel: {source_channel} -> {part.messageid}")
    
    return newParts