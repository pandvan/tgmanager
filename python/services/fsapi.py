import logging
from services.database import TGFolder, TGFile, TGPart, start_session, list_file_in_folder_recursively, getItem, removeItem, purgeItem, create_file, update_file, getItemByFilename, getChildren, create_folder, remap, update_folder
from constants import ROOT_ID
from configuration import Config
from services.telegram import TelegramApi
import mimetypes
from services.downloader import Downloader
from services.tgclients import TGClients
from services.uploader import Uploader
import os

Log = logging.getLogger('FSApi')

class FSApi():

  root_folder: TGFolder = None

  def __init__(self, root: TGFolder):
    self.root_folder = root

  @staticmethod
  def build_path(item: TGFolder | TGFile, sep = '/'):
    paths = [] if item.id == ROOT_ID else [ item.filename ]
    p = item
    
    while p.parentfolder is not None:
      p = getItem(p.parentfolder)
      if ( p is None or p.id == ROOT_ID ):
        break
      paths.insert(0, p.filename )
    
    return sep.join( paths )

  def split_path(self, path: str):
    p = path
    if p.startswith('/'):
      p = p[1:]
    
    if p.endswith('/'):
      p = p[0 : -1]

    # TODO: filter by Boolean
    paths = p.split('/')
    res = []
    for p in paths:
      if not p: continue
      res.append(p)
    return res
  

  def exists(self, path: str, parent_id: str = ROOT_ID, state = None, session= None):
    if parent_id == ROOT_ID:
      item = self.root_folder
    else:
      item = getItem(parent_id, session= session)
    
    paths = self.split_path(path)

    while( len(paths) > 0 ):
      childName = paths[0]
      paths = paths[1:]
      item_id = item.id
      item = getItemByFilename(childName, item_id, session= session)
      if ( item is None ):
        return None

    if item is not None:
      if state is not None:
        if item.state != state:
          return None
    return item

  def get_last_folder(self, path: str, skipLast: bool = False):
    paths = self.split_path(path)
    if ( skipLast ):
      paths.pop()

    folder = self.root_folder

    while( len(paths) > 0 ):
      childName = paths[0]
      paths = paths[1:]
      parentId = folder.id
      folder = getItemByFilename(childName, parentId)
      if ( folder is None ):
        return None
    
    return folder

  async def size(self, path: str):
    file = self.get_last_folder(path)
    size = 0
    if ( file is None ):
      raise Exception(f"'{path}' not found")
    
    if file.type != 'folder':
      if file.parts is not None and len(file.parts) > 0:
        for part in file.parts:
          size += part.size
      elif ( file.content is not None):
        size = len(file.content)
        
    
    return size

  async def list_dir(self, path: str):
    folder = self.get_last_folder(path)

    if folder is None:
      raise Exception(f"'{path}' not found")

    children = getChildren(folder.id)
    return [ folder ] + children

  async def create(self, path: str, isFolder: bool):

    folder = self.get_last_folder(path, True)

    if ( folder is None ):
      Log.error(f"'{path}' not found")
      raise Exception(f"'${path}' not found")
    
    filename = self.split_path(path).pop()
    
    if (isFolder):

      newFolder = create_folder( TGFolder(
        parentfolder = folder.id,
        filename = filename,
      ), folder.id)

      return newFolder
    
    else:

      channelid = None
      p = folder.id
      while ( channelid is None ):
        pf = await getItem(p)
        channelid = pf.channel
        if (pf.id == ROOT_ID):
          break
        p = pf.parentfolder

      if ( channelid is None ):
        Log.info('file will be created into default channel');
        channelid = Config.telegram.upload.channel

      dbFile = create_file( TGFile(
        filename = filename,
        type = mimetypes.guess_type(filename)[0] or 'application/octet-stream',
        channel = channelid,
        state = 'ACTIVE'
      ), folder.id)

      return dbFile


  def create_folder_recursive(self, folderpath: str, start_parent = ROOT_ID, skip_last = False):

    path = self.split_path(folderpath)
    if skip_last:
      path.pop()

    parentFolder = getItem(start_parent)

    is_created = False

    while( len(path) > 0 ):
      folderName = path[0]
      path = path[1:]

      destPath = getItemByFilename( folderName, parentFolder.id, 'folder')
      if ( destPath is None ):
        destPath = create_folder( TGFolder(
          parentfolder = parentFolder.id,
          filename = folderName
        ), parentFolder.id)
        is_created = True
      
      parentFolder = destPath

      if is_created:
        Log.info(f"folder '{folderpath}' has been created!")
    
    return parentFolder
  
  
  async def move(self, pathFrom: str, pathTo: str):
    return await self.move_or_copy(pathFrom, pathTo, True)
  
  async def copy(self, pathFrom: str, pathTo: str):
    return await self.move_or_copy(pathFrom, pathTo, False)

  async def move_or_copy(self, pathFrom: str, pathTo: str, is_move = False):

    (session, transaction) = start_session()

    with transaction:

      pathsTo = self.split_path(pathTo)

      oldFile = self.get_last_folder(pathFrom)

      if ( oldFile is None ):
        raise Exception(f"'${pathFrom}' not found")
      
      parentFolder = getItem(ROOT_ID)
      destChannelid = None

      while( len(pathsTo) - 1 > 0 ):
        folderName = pathsTo[0]
        pathsTo = pathsTo[1:]

        destPath = getItemByFilename( folderName, parentFolder.id, 'folder', session= session)
        if ( destPath is None ):
          # destPath = create_folder( TGFolder(
          #   parentfolder = parentFolder.id,
          #   filename = folderName
          # ), parentFolder.id, session= session)
          raise Exception(f"folder '{folderName}' not exists")
        
        parentFolder = destPath
        destChannelid = parentFolder.channel or destChannelid

      # get new name
      filename = pathsTo[0]
      pathsTo = pathsTo[1:]

      already_existing_folder = getItemByFilename(filename, parentFolder.id, 'folder', session= session)

      if already_existing_folder is not None:
        parentFolder = already_existing_folder
        filename = oldFile.filename

        if already_existing_folder.channel:
          destChannelid = already_existing_folder.channel
      

      if ( destChannelid is None ):
        Log.info('[move] file will be moved into default channel')
        destChannelid = Config.telegram.upload.channel

      filename = self.calculate_filename_for_copy(filename, parentFolder, is_folder= (oldFile.type == 'folder'))

      oldFileData = remap(oldFile)
    
      if ( oldFile.type == 'folder' ):
        
        newFolderData = None
        
        if is_move:
          newFolderData = update_folder(oldFileData, TGFolder(
            parentfolder = parentFolder.id, 
            filename = filename
          ), parentFolder.id, session= session)
        else:
          oldFileData.id = None
          oldFileData.filename = filename
          newFolderData = create_folder(oldFileData, parentFolder.id, session= session)

        # move all contents into new folder
        await self.move_or_copy_all_contents_into_new_folder(oldFile, newFolderData, destChannelid, is_move, session= session)
      
      else:
        new_parts = oldFileData.parts
        if ( (oldFileData.content is None or oldFileData.content_length() <= 0) and len(oldFileData.parts) > 0 ):
          # file is located on telegram: move it to new channel if needed
          if ( oldFileData.channel != destChannelid ):
            # file needs to be moved between channels

            new_parts = self.forward_file_between_channels(oldFileData, oldFileData.channel, destChannelid, delete_original = is_move)

        if is_move:
          update_file(oldFileData, TGFile(
            parentfolder = parentFolder.id,
            filename = filename,
            channel = destChannelid or oldFileData.channel,
            parts = new_parts
          ), parentFolder.id, session= session)
        else:
          oldFileData.id = None
          oldFileData.filename = filename
          oldFileData.channel = destChannelid or oldFileData.channel
          oldFileData.parts = new_parts

          create_file(oldFileData, parentFolder.id, session= session)




  # async def copy(self, pathFrom, pathTo):

  #   pathsTo = self.split_path(pathTo)

  #   oldFile = self.get_last_folder(pathFrom)

  #   if ( oldFile is None ):
  #     raise Exception(f"'${pathFrom}' not found")

  #   parentFolder = getItem(ROOT_ID)
  #   destChannelid = None

  #   while( len(pathsTo) - 1 > 0 ):
  #     folder_name = pathsTo[0]
  #     pathsTo = pathsTo[1:]
  #     destPath = getItemByFilename( folder_name, parentFolder.id, 'folder')
  #     if ( destPath is None ):
  #       destPath = create_folder( TGFolder(
  #         filename = folder_name,
  #         parentfolder = parentFolder.id
  #       ), parentFolder.id)
      
  #     parentFolder = destPath
  #     destChannelid = destChannelid or parentFolder.channel

  #   # get new name
  #   filename = pathsTo[0]
  #   pathsTo = pathsTo[1:]

  #   filename = self.calculate_filename_for_copy(filename, parentFolder, is_folder= oldFile.type == 'folder')

  #   if ( oldFile.type == 'folder' ):
  #     new_folder = create_folder(TGFolder(
  #       filename = filename,
  #       parentfolder = parentFolder.id
  #     ), parentFolder.id)


  #     # copy all contents into new folder
  #     await self.move_or_copy_all_contents_into_new_folder(oldFile, new_folder, destChannelid, False)
    
  #   else:
    
  #     data = remap(oldFile)
  #     data.id = None
  #     data.filename = filename
  #     if ( data.content is not None and data.content_length() > 0):
  #       # file is located in db
  #       data.parentfolder = parentFolder.id
  #       create_file( data, parentFolder.id)

  #     elif data.parts is not None and len(data.parts) > 0 and data.channel != destChannelid:
  #       # file is located on telegram, we need to copy messages
  #       new_parts = await self.forward_file_between_channels(data, data.channel, destChannelid, delete_original= False )
  #       data.parts = new_parts

  #       create_file( data, parentFolder.id)

  async def read_file_content(self, path, start = 0, end = -1):
    paths = self.split_path(path)
    folder = self.get_last_folder(path, True)

    if ( folder is None ):
      raise Exception(f"'${path}' parentFolder not found")
    
    filename = paths.pop()
    file = getItemByFilename(filename, folder.id)

    if ( file is None ):
      raise Exception(f"'{path}' not found")

    totalsize = 0
    if ( file.parts is not None and len(file.parts) > 0 ):
      for part in file.parts:
        totalsize += part.size
    elif ( file.content is not None):
      totalsize = file.content_length()

    if end == -1:
      end = totalsize - 1
    
    totalsize = int(totalsize)

    client = TGClients.next_client(True)

    Log.info(f"serve file '{filename}', bytes: {start}-{end}, total: {totalsize}")

    service = Downloader(client, file, start, end)

    return service

  async def create_file_with_content(self, path: str, stop_if_exists = False):
    paths = self.split_path(path)
    folder = self.get_last_folder(path, True)

    if folder is None:
      raise Exception(f"'{path}' not found")
    
    filename = paths.pop()

    channelid = None
    Log.debug(f"calculate path and channel starting from '{folder.filename}'")
    p = folder.id
    while ( not channelid ):
      pf = getItem(p)
      channelid = pf.channel
      if (pf.id == ROOT_ID):
        break
      if (channelid):
        Log.debug(f"found channelid {channelid} for folder '{pf.filename}'")
      else:
        Log.debug(f"folder '{pf.filename}' has no channel, continue on parent folder -> {pf.parentfolder}")
      p = pf.parentfolder
    

    if ( not channelid ):
      Log.info('file will be uploaded into default channel')
      channelid = Config.telegram.upload.channel
    else:
      Log.info(f"file will be uploaded in channel: {channelid}")

    client = TGClients.next_client()

    session, transation = start_session()

    with transation:

      uploader = Uploader(client, filename, channelid)

      dbFile = getItemByFilename(filename, folder.id, state = None, session= session)
      if dbFile is not None and dbFile.state == 'TEMP':
        Log.warning(f"already existing TEMPORARY file '{filename}' in '{folder.filename}'")

      if dbFile is not None and dbFile.id:

        if dbFile.state == 'DELETED':
          Log.warning(f"file '{dbFile.filename}' has been previously deleted from '{folder.filename}'")
          # in case of the same file has been previously deleted
          # we need to force deletion in order to avoid duplicated files
          purgeItem(dbFile.id, session= session)
          

        if stop_if_exists and dbFile.state == 'ACTIVE' :
          raise Exception(f"file '{dbFile.filename}' already exists in '{folder.filename}'")

      #   dbFile = update_file(dbFile, TGFile(
      #     filename = filename,
      #     channel = channelid,
      #     type = mimetypes.guess_type(filename)[0] or 'application/octet-stream',
      #     parentfolder = folder.id
      #   ), folder.id, session= session)
      # else:

      # create a new temp file for the uploading file
      dbFile = create_file(TGFile(
        filename = filename,
        channel = channelid,
        type = mimetypes.guess_type(filename)[0],
        parentfolder = folder.id,
        state = 'TEMP'
      ), folder.id, session= session)


      def on_stopped(*args):
        Log.warning(f"Process aborted, remove item: {dbFile.id} - {dbFile.filename}")
        purgeItem(dbFile.id, session= session)

      uploader.on('stopped', on_stopped)
      uploader.on('error', on_stopped)
                    

      def on_complete_upload(*args):

        newFileData = getItem(dbFile.id, state = None, session= session)
        newFileData.state = 'ACTIVE'
        update_file(dbFile, newFileData, session= session)

        Log.info(f"File has been processed: [{dbFile.id}] '{dbFile.filename}'")

      uploader.on('completeUpload', on_complete_upload)


      def on_portion_upload(portion, *args):
        Log.debug(f"Portion of file has been uploaded, save it into DB: {vars(portion)}")

        chl = channelid

        newFileData = getItem(dbFile.id, state= None, session= session)
        newFileData.channel = chl or newFileData.channel

        if portion.content is not None:
          # file will be stored in DB
          newFileData.content = portion.content
          newFileData.parts = None
        else:
          newFileData.content = None
          if newFileData.parts is None:
            newFileData.parts = []
          newFileData.parts.append( TGPart(
            messageid = portion.msg_id,
            originalfilename = portion.filename,
            hash = '',
            fileid = str(portion.file_id),
            size = int(portion.size),
            index = portion.index
          ) )

          # newFileData.state = 'ACTIVE'

        update_file(dbFile, newFileData, session= session)

        Log.debug(f"file has been correctly uploaded, id: '{dbFile.id}'")


      uploader.on('portionUploaded', on_portion_upload)

      Log.info(f"file '{filename}' is being uploaded, id: '{dbFile.id}'")
    
    return uploader

  async def delete(self, path, simulate = False):

    paths = self.split_path(path)
    folder = self.get_last_folder(path, True)

    if ( not folder ):
      raise Exception(f"'{path}' not found")
    
    filename = paths.pop()

    item = getItemByFilename(filename, folder.id)
    if ( not item ):
      raise Exception(f"'{filename}' not found under {folder.id}")

    Log.info(f"trying to delete '{item.filename}' [{item.id}], type: {item.type}")

    (session, transaction) = start_session()

    with transaction:

      if (item.type == 'folder'):

        Log.debug(f"collecting all files in '{item.filename}' and its subfolders")
        all_folders_and_files = list_file_in_folder_recursively(item.id, session= session)

        Log.info(f"got {len(all_folders_and_files)} items to be deleted")

        for file_or_folder in all_folders_and_files:

          if file_or_folder.type == 'folder':
            if simulate:
              Log.info(f"'{file_or_folder.filename}' may be deleted, skip as per dry_run")
            else:
              Log.debug(f"'{file_or_folder.filename}' [{file_or_folder.id}] will be deleted")
              removeItem(file_or_folder.id, session= session)
          else:
            if simulate:
              Log.info(f"'{file_or_folder.filename}' may be deleted, skip as per dry_run")
            else:
              Log.debug(f"'{file_or_folder.filename}' [{file_or_folder.id}] and its parts will be deleted")
              await self.remove_file(file_or_folder, session)

        itemdata = remap(item)
        if simulate:
          Log.info(f"'{itemdata.filename}' may be deleted, skip as per dry_run")
        else:
          removeItem(itemdata.id, session= session)
          Log.info(f"folder '{itemdata.filename}' and all its content have been deleted")

      else:
        await self.remove_file(item, session)


  async def remove_file(self, file: TGFile, session= None):
    data = remap(file)

    if data.content and data.content_length():
      # file is a local file in DB
      removeItem(data.id, session= session)
      Log.info(f"file '{data.filename}' has been deleted")
    else:
      # file is located on telegram
      parts = data.parts
      if parts is not None:
      
        client = TGClients.next_client()

        for part in parts:
          mess = await client.get_message(data.channel, part.messageid)
          if ( mess and mess.media ):
            media = TelegramApi.get_media_from_message(mess)
            document = media
            if str(part.fileid) == str(document.filedata.media_id):
              # ok, proceed to delete message
              await client.delete_message(data.channel, part.messageid)
              # if (resp.pts_count > 1):
              #   that's odd!
              #   raise Exception(f"Deleted more than 1 message")
              
            else:
              Log.error(f"File mismatch: fileid '{document.filedata.media_id}' is different for message '{mess.id}': {part.fileid}")
              # callback(v2.Errors.InvalidOperation);
              raise Exception(f"File mismatch: fileid '{document.filedata.media_id}' is different for message '{mess.id}'")
            
          else:
            Log.error(f"cannot retrieve message from chat {data.channel} part: '{part.messageid}' for file '{data.filename}'")
            # Silently fails
            #raise Exception(f"cannot retrieve message from chat: {data.channel} part: {part.messageid}")

      itemdata = remap(file)
      removeItem(itemdata.id, session= session)
      Log.info(f"file '{itemdata.filename}' has been deleted, even from telegram")


  async def forward_file_between_channels(self, dbFile, source_ch, dest_ch, delete_original = False):
    
    client = TGClients.next_client()

    newParts = []
    for part in dbFile.parts:
      message = await client.get_message(source_ch, part.messageid)
      if message:
        media = TelegramApi.get_media_from_message(message)
        if str(part.fileid) == str(media.filedata.media_id):
          resp = await client.forward_message(source_ch, dest_ch, part.messageid)
          has_part = False
          for update in resp.updates:
            if getattr(update, 'message', None) is not None:
              newParts.append({
                'messageid': update.message.id,
                'originalfilename': part.originalfilename,
                'hash': part.hash,
                'fileid': part.fileid,
                'size': part.size,
                'index': part.index
              })
              has_part = True
              break

          # deplete old art
          if has_part:
            if delete_original:
              resp = await client.delete_message(source_ch, part.messageid)
              if resp.pts_count != 1:
                raise Exception(f"More than one message has been deleted")
          else:
            raise Exception(f"cannot forward file between channels: {source_ch} -> {dest_ch}")
        
        else: 
          Log.warn(f"file_id is different: {str(part.fileid)} - {str(media.filedata.media_id)}, channel: {source_ch}, message: {part.messageid}")
          newParts.append(part)
      else:
        Log.warn(f"cannot get message from channel: {source_ch} -> {part.messageid}")
        newParts.append(part)
    
    return newParts
  



  def calculate_filename_for_copy(self, filename: str, parentfolder: TGFolder, is_folder = False):
    fn = filename
    index = 0
    while True:
      item = getItemByFilename(fn, parentfolder.id)
      if item is not None:
        index += 1
        if is_folder:
          fn = f"{filename} - {str(index)}"
        else:
          _fn, ext = os.path.splitext(filename)
          fn = f"{_fn} - {str(index)}{ext}"
      else:
        break
    
    return fn




  async def move_or_copy_all_contents_into_new_folder(self, source_folder: TGFolder, original_dest_folder: TGFolder, dest_channel: str = None, is_move = False, session = None):
    # copy or move all contents into new folder
    all_folders_and_files = list_file_in_folder_recursively(source_folder.id, session= session)
    
    for item in all_folders_and_files:

      # keep original-file's parentfolder
      dest_folder = getItem(item.parentfolder, session= session)

      if not is_move:
        # we are coping files and folders
        
        # calculate new destination-folder in case of "copy", starting from new copied folder
        dest_folder = original_dest_folder

        if item.path and len(item.path) > 0:
          found = False
          for folder in item.path:

            if found or folder.parentfolder == source_folder.id:
              found = True
              # duplicate folder for copy
              f = getItemByFilename(folder.filename, dest_folder.id, 'folder', session= session)
              if f is None:
                dest_folder = create_folder(TGFolder(
                  filename = folder.filename,
                  parentfolder = dest_folder.id
                ), dest_folder.id, session= session)
              else:
                dest_folder = f
        
        if item.type == 'folder':

          create_folder(TGFolder(
            filename = item.filename,
            parentfolder = dest_folder.id
          ), dest_folder.id, session= session)

        elif item.content is not None and item.content_length() > 0:
          
          # local file into DB
          new_file = TGFile(
            filename = item.filename,
            parentfolder = dest_folder.id,
            content = item.content,
            parts = None,
            type = item.type,
            info = item.info,
            channel = dest_channel,
            state = item.state
          )

          # we are coping file: create a new file
          create_file( new_file, dest_folder.id, session= session )

      if item.type != 'folder' and item.parts is not None and len(item.parts) > 0:

        new_parts = item.parts
        if item.channel != dest_channel:
          # in case of we have different channels, we need to forward messages on telegram
          new_parts = await self.forward_file_between_channels(item, item.channel, dest_channel, delete_original= is_move )
        
        item.parts = new_parts

        item.channel = dest_channel or item.channel
        
        if not is_move:
          # we are coping file: create a new file
          item.id = None
          create_file(item, dest_folder.id, session= session)
        else:
          # we are moving file: modify parentfolder
          update_file(item, item, dest_folder.id, session= session)
        
    
  def calculate_channel_from_path(self, path: str):

    paths = self.split_path(path)

    item = self.get_last_folder(paths)

    return self.calculate_channel_from_folder_or_file(item)

  def calculate_channel_from_folder_or_file(self, item: TGFolder | TGFile):

    current_item = item
    if current_item.type != 'folder':
      current_item = getItem(current_item.parentfolder)
    
    while current_item and current_item.id != ROOT_ID:
      channel = current_item.channel
      if channel:
        return channel
      
      current_item = getItem(current_item.parentfolder)
    
    return current_item.channel