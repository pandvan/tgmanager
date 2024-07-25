from pymongo import MongoClient
from configuration import Config
from urllib.parse import urlparse
from constants import ROOT_ID, ROOT_NAME
import re
import base64
import random
import string
from types import SimpleNamespace

import logging

Log = logging.getLogger('DB')


class TGFolder:
  def __init__(self, id = '', filename = '', channel = '', parentfolder = '', info = {}, state = 'ACTIVE'):
    self.id = id
    self.filename = filename
    self.channel = channel
    self.parts = None
    self.parentfolder = parentfolder
    self.type = 'folder'
    self.info = info
    self.content = None
    self.state = state or 'ACTIVE'

class TGPart:
  def __init__(self, messageid: int = 0, originalfilename: str = '', fileid: str = '', size: int = 0, index: int = -1, hash: str | None = None):
    self.messageid = messageid
    self.originalfilename = originalfilename
    self.fileid = fileid
    self.size = size
    self.index = index
    self.hash = hash

type TGParts = list[TGPart]

class TGFile:
  def __init__(self, id = '', filename = '', channel = '', parts: TGParts | None = None, parentfolder = '', type = '', info = {}, content: bytes | None = None, state = 'ACTIVE'):
    self.id = id
    self.filename = filename
    self.channel = channel
    self.parts = parts
    self.parentfolder = parentfolder
    self.type = type
    self.info = info
    self.content = content
    self.state = state or 'ACTIVE'
  
  def content_length(self):
    return len( self.content )

def init_database():
  Log.info(f"init database")

  mongo = MongoClient( Config.db )
  dbname = urlparse(Config.db)
  database = mongo[ dbname.path[1:] ]

  try:
    database.create_collection('entries')
  except Exception as e:
    Log.warn(f"error occurred while create schema")
    Log.warn(e)
  
  try:
    database.create_collection('telegramdata')
  except Exception as e:
    Log.warn(f"error occurred while create schema")
    Log.warn(e)

  global DB
  DB = database['entries']

  global TGData
  TGData = database['telegramdata']

  rootfolder = getItem( ROOT_ID )
  if rootfolder is None:
    # create folder
    fld = TGFolder()
    fld.id = ROOT_ID
    fld.channel = Config.telegram.upload.channel
    fld.filename = ROOT_NAME
    create_folder(fld, None )


def remap(ret):
  item = TGFolder()
  if ret['type'] != 'folder':
    item = TGFile()
  
  item.id = ret['id']
  item.filename = ret['filename']
  item.channel = ret['channel']
  parts = None
  if 'parts' in ret:
    if ret['parts'] is not None:
      parts = []
      for p in ret['parts']:
        part = TGPart()
        part.messageid = p['messageid']
        part.originalfilename = p['originalfilename']
        part.fileid = p['fileid']
        part.size = p['size']
        part.index = p['index']
        part.hash = p['hash']

        parts.append(part)

  item.parts = parts
  item.parentfolder = ret['parentfolder']
  item.type = ret['type']
  item.info = ret['info']
  item.content = ret['content']
  item.state = ret['state']
  return item


def getItem(id):
  ret = DB.find_one({'id': id})
  if ret is not None:
    return remap(ret)

def getChildren(folderId, type = None):
  filter = {
    'parentfolder': folderId
  }

  if type is not None:
    filter['type'] = type

  ret = DB.find(filter)

  res = []
  for item in ret:
    res.append( remap(item) )

  return res

def removeItem(itemId):
  if itemId == ROOT_ID:
    raise Exception('Cannot remote root folder')

  ret = DB.delete_one({'id': itemId})
  return ret

def getItemByFilename(filename: str, parent: str = None, type: str = None):
  filter = {}
  if parent is not None: 
    filter['parentfolder'] = parent
  
  fn = re.sub("/", "-", filename, flags=re.IGNORECASE)
  filter['filename'] = fn

  if type is not None:
    filter['type'] = type

  if parent is not None:
    ret = DB.find_one(filter)
    if ret is not None:
      return remap( ret )
  else:
    ret = DB.find(filter)
    res = []
    for item in ret:
      res.append( remap(item) )


def check_exist(filename, parent, type = None, id = None):
  fn = re.sub("/", "-", filename, flags=re.IGNORECASE)
  regexp = re.compile( f"^{fn}", re.IGNORECASE)
  filter = {
    "filename": regexp,
    "parentfolder": parent
  }

  if id is not None:
    # suppose 'modify' action
    filter['id'] = {'$not': { '$eq': id}}

  if type is not None:
    filter['type'] = type

  ret = DB.count_documents(filter)
  return ret > 0



def create_folder(folder: TGFolder, parent = None):
  
  # check existing
  if check_exist(folder.filename, parent or folder.parentfolder, 'folder'):
    raise Exception(f"Folder '{folder.filename}' already exists in '{parent}'")

  # return await this.write( async () => {

  fn = re.sub("/", "-", folder.filename, flags=re.IGNORECASE)

  folder.type = 'folder'
  folder.filename = fn
  folder.parentfolder = parent or folder.parentfolder
  folder.state = folder.state or 'ACTIVE'
  folder.parts = None
  folder.content = None

  if not folder.id:
    folder.id = get_UUID()

  DB.insert_one( vars(folder) )



def update_folder(folder: TGFolder, data: TGFolder, parent = None):
    # check existing
  if check_exist(folder.filename, parent or folder.parentfolder, 'folder', data.id or folder.id):
    raise Exception(f"Folder '{data.filename}' already exists in '{parent}'")
  
  if not folder.id:
    raise Exception(f"Cannot update folder without id")

  # const oldFold = this.remap(folder);
  fn = re.sub("/", "-", folder.filename, flags=re.IGNORECASE)

  folder.type = 'folder'
  folder.filename = fn
  folder.parentfolder = parent or data.parentfolder or folder.parentfolder
  folder.state = 'ACTIVE'
  folder.channel = data.channel or folder.channel
  
  DB.update_one({id: folder.id}, {'$set': vars(folder)})
  return getItem(folder.id)


def create_file(file: TGFile, parent = None):
  
  # check existing
  if check_exist(file.filename, parent or file.parentfolder, file.type):
    raise Exception(f"File '{file.filename}' already exists in '{parent}'")

  if (not file.content or file.content_length() <= 0) and not file.channel:
    raise Exception(f"File {file.filename} has no channel")


  fn = re.sub("/", "-", file.filename, flags=re.IGNORECASE)
  file.filename = fn
  file.parentfolder = parent or file.parentfolder
  file.type = file.type or 'application/octet-stream'
  file.state = file.state or 'ACTIVE'

  if file.content is not None:
    if type( file.content ) is not bytes:
      file.content = base64.b64decode( file.content )
    
  if not file.id:
    file.id = get_UUID()
    
  ret = DB.insert_one( vars(file) )

  # faster than getItem
  obj = DB.find_one({'_id': ret.inserted_id})
  return remap( obj )


def update_file(file: TGFile, data: TGFile, parent = None):
  # check existing
  if check_exist(file.filename, parent or file.parentfolder, file.type, file.id):
    raise Exception(f"`File '{file.filename}' already exists in '{parent}'")

  if not file.id:
    raise Exception(f"Cannot update file without id")


  insert = vars(file)

  fn = re.sub("/", "-", data.filename or file.filename, flags=re.IGNORECASE)

  insert['type'] = data.type or file.type
  insert['filename'] = fn
  insert['parentfolder'] = parent or data.parentfolder or file.parentfolder
  insert['state'] = data.state or file.state or 'ACTIVE'
  insert['channel'] = data.channel if data.channel is not None else file.channel


  parts = None
  _parts = data.parts or file.parts
  if _parts is not None:
    parts = []
    for p in _parts:
      parts.append( vars(p) )

  insert['parts'] = parts

  if data.content:
    if type( data.content ) is not bytes:
      insert['content'] = base64.b64decode(data.content)
    else:
      insert['content'] = data.content

  DB.update_one({'id': insert['id']}, { '$set': insert})
  return getItem(insert['id'])


def get_files_by_messageI_id_and_channel(msgId: int, channel: str):
  filter = {
    'type': { '$not': { '$eq': 'folder' } },
    'channel': channel,
    'state': { '$not': { '$eq': 'TEMP' } },
    'parts.0': { '$exists': True },
    'parts.messageid': msgId
  }

  return DB.find(filter)

def get_folder_by_channel(channelId: str):
  filter = {
    'type': 'folder',
    'channel': channelId
  }
  return DB.find(filter)


def get_telegram_data(key: str):
  return TGData.findOne({ 'key': key })

def set_telegram_data(data):

  existing = get_telegram_data(data['key'])
  if existing is not None:
    TGData.update_one({'key': data['key']}, data)
  else:
    TGData.insert_one( data )
  

def get_UUID():
  alphabet = string.ascii_lowercase + string.digits
  return ''.join( random.choices(alphabet, k=10) )