import logging
from services.database import TGFolder, TGFile, TGPart, getItem, removeItem, create_file, update_file, getItemByFilename, getChildren, create_folder, remap, update_folder
from constants import ROOT_ID
from configuration import Config
import base64
import mimetypes
from services.downloader import Downloader
from services.tgclients import TGClients
from services.uploader import Uploader

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
      p = p[0, -1]

    # TODO: filter by Boolean
    return p.split('/')
  
  async def get_last_folder(self, path: str, skipLast: bool = False):
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
    file = await self.get_last_folder(path)
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
    folder = await self.get_last_folder(path)

    if folder is None:
      raise Exception(f"'{path}' not found")

    children = getChildren(folder.id)
    return [ folder ] + children

  async def create(self, path: str, isFolder: bool):

    folder = await self.get_last_folder(path, True)

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

  async def move(self, pathFrom: str, pathTo: str):

    pathsTo = self.split_path(pathTo)

    oldFile = await self.get_last_folder(pathFrom)

    if ( oldFile is None ):
      raise Exception(f"'${pathFrom}' not found")
    
    parentFolder = getItem(ROOT_ID)
    destChannelid = None

    while( len(pathsTo) - 1 > 0 ):
      folderName = pathsTo[0]
      pathsTo = pathsTo[1:]

      destPath = getItemByFilename( folderName, parentFolder.id, 'folder')
      if ( destPath is None ):
        destPath = create_folder( TGFolder(
          parentfolder = parentFolder.id,
          filename = folderName
        ), parentFolder.id)
      
      parentFolder = destPath
      destChannelid = destChannelid or parentFolder.channel

    if ( destChannelid is None ):
      Log.info('[move] file will be uploaded into default channel')
      destChannelid = Config.telegram.upload.channel

    # get new name
    filename = pathsTo[0]
    pathsTo = pathsTo[1:]

    oldFileData = remap(oldFile)
  
    if ( oldFile.type == 'folder' ):
      update_folder(oldFileData, TGFolder(
        parentfolder = parentFolder.id, 
        filename = filename
      ), parentFolder.id)
    
    else:

      if ( (oldFileData.content is None or oldFileData.content_length() <= 0) and len(oldFileData.parts) > 0 ):
        # file is located on telegram: move it to new channel if needed
        if ( oldFileData.channel != destChannelid ):
          # file needs to be moved between channels

          client = TGClients.next_client()

          newParts = []
          for part in oldFileData.parts:
            resp = await client.forward_message(oldFileData.channel, destChannelid, part.messageid)
            
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
                break

            # deplete old art
            resp = await client.delete_message(oldFileData.channel, part.messageid)
            if resp.pts_count != 1:
              # callback(v2.Errors.InvalidOperation);
              raise Exception(f"More than one message has been deleted");


      update_file(oldFileData, TGFile(
        parentfolder = parentFolder.id,
        filename = filename,
        channel = destChannelid or oldFileData.channel,
        parts = newParts
      ), parentFolder.id)

  async def copy(self, pathFrom, pathTo):

    pathsTo = self.split_path(pathTo)

    oldFile = await self.get_last_folder(pathFrom)

    if ( oldFile is None ):
      raise Exception(f"'${pathFrom}' not found")

    parentFolder = getItem(ROOT_ID)
    destChannelid = None

    while( len(pathsTo) - 1 > 0 ):
      folder_name = pathsTo[0]
      pathsTo = pathsTo[1:]
      destPath = getItemByFilename( folder_name, parentFolder.id, 'folder')
      if ( destPath is None ):
        destPath = create_folder( TGFolder(
          filename = folder_name,
          parentfolder = parentFolder.id
        ), parentFolder.id)
      
      parentFolder = destPath
      destChannelid = destChannelid or parentFolder.channel

    # get new name
    filename = pathsTo[0]
    pathsTo = pathsTo[1:]

    if ( oldFile.type == 'folder' ):
      update_folder(oldFile, TGFolder(
        filename = filename,
        parentfolder = parentFolder.id
      ), parentFolder.id)
    
    else:
    
      data = remap(oldFile)
      data.id = None
      if ( data.content is not None and data.content_length() > 0):
        # file is located in db
        data.parentfolder = parentFolder.id
        data.filename = filename
        create_file( data, parentFolder.id)

      else:
        # file is located on Telegram, need to be forwarded

        client = TGClients.next_client()

        if ( destChannelid is None ):
          Log.info('file will be uploaded into default channel')
          destChannelid = Config.telegram.upload.channel

        newParts = []
        for part in oldFile.parts:
          resp = resp = await client.forward_message(oldFile.channel, destChannelid, part.messageid)
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
              break
        
        oldFile.id = None
        oldFile.parts = newParts
        oldFile.parentfolder = parentFolder.id
        create_file( oldFile, parentFolder.id)

  async def read_file_content(self, path, stream, start = 0, end = -1):
    paths = self.split_path(path)
    folder = await self.get_last_folder(path, True)

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

    if file.content is not None:
      if type( file.content ) is bytes:
        await stream.write( file.content )
      else:
        await stream.write( base64.decodebytes(file.content) )
      
      # close stream
      try:
        await stream.write_eof()
      except Exception as e:
        Log.warn('cannot write_eof')
      
      return None

    client = TGClients.next_client()

    Log.info(f"serve file '{filename}', bytes: {start}-{end}, total: {totalsize}")

    service = Downloader(client, file, start, end)

    return service

  async def create_file_with_content(self, path: str, callback = None):
    paths = self.split_path(path)
    folder = await self.get_last_folder(path, True)

    if folder is None:
      raise Exception(f"'{path}' not found")
    
    filename = paths.pop()

    channelid = None
    p = folder.id
    while ( channelid is None ):
      pf = getItem(p)
      channelid = pf.channel
      if (pf.id == ROOT_ID):
        break
      p = pf.parentfolder
    

    if ( channelid is None ):
      Log.info('file will be uploaded into default channel')
      channelid = Config.telegram.upload.channel

    client = TGClients.next_client();

    uploader = Uploader(client, filename, channelid)

    dbFile = getItemByFilename(filename, folder.id)
    if dbFile is not None and dbFile.state == 'TEMP':
      Log.warn(f"already existing TEMPORARY file '{filename}' in '{folder.filename}'")

    if dbFile is not None and dbFile.id:
      dbFile = update_file(dbFile, TGFile(
        filename = filename,
        channel = channelid,
        type = mimetypes.guess_type(filename)[0],
        parentfolder = folder.id
      ), folder.id)
    else:
      # create a new temp file
      dbFile = create_file(TGFile(
        filename = filename,
        channel = channelid,
        type = mimetypes.guess_type(filename)[0],
        parentfolder = folder.id,
        state = 'TEMP'
      ), folder.id)

      def on_stopped():
        removeItem(dbFile.id)

      uploader.on('stopped', on_stopped)
                  

    def on_complete_upload(*args):
      if callback is not None:
        callback(dbFile)
      Log.info(f"File has been processed: [{dbFile.id}] '{dbFile.filename}'")
    uploader.on('completeUpload', on_complete_upload)


    def on_portion_upload(portion, *args):

      chl = channelid

      newFileData = getItem(dbFile.id)
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

        newFileData.state = 'ACTIVE'

      update_file(dbFile, newFileData)

      Log.debug(f"file has been correctly uploaded, id: '{dbFile.id}'")


    uploader.on('portionUploaded', on_portion_upload)

    Log.info(f"file '{filename}' is being uploaded, id: '{dbFile.id}'")
    
    return uploader




