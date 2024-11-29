from pymongo import MongoClient, TEXT
import datetime
from configuration import Config
from urllib.parse import urlparse
from constants import ROOT_ID, ROOT_NAME
import threading
import re
import time
import base64
import random
import string

import logging

Log = logging.getLogger('DB')


FN_CALLBACK = []


def NOW():
  return datetime.datetime.now(datetime.UTC)


class TGPart:
  def __init__(self, messageid: int = 0, originalfilename: str = '', fileid: str = '', size: int = 0, index: int = -1, hash: str | None = None):
    self.messageid = messageid
    self.originalfilename = originalfilename
    self.fileid = fileid
    self.size = size
    self.index = index
    self.hash = hash
  
  def toDB(self):
    return {
      'messageid': self.messageid,
      'originalfilename': self.originalfilename,
      'fileid': self.fileid,
      'size': self.size,
      'index': self.index,
      'hash': self.hash
    }


class TGItem:

  def __init__(self, id = '', filename = '', channel = '', parts: list[TGPart] | None = None, parentfolder = '', type = '', info = {}, content: bytes | None = None, state = 'ACTIVE', ctime = None, mtime = None, path = None):
    self.id = id
    self.filename = filename
    self.channel = channel
    self.parts = parts
    self.parentfolder = parentfolder
    self.type = type
    self.info = info
    self.content = content
    self.state = state or 'ACTIVE'

    self.ctime = ctime or NOW()
    self.mtime = mtime or NOW()

    self.path = path
  
  def is_deleted(self):
    return self.state == 'DELETED'
  
  def content_length(self):
    if self.content is not None:
      return len( self.content )
    else:
      return 0
  
  def toDB(self, for_web = False):

    parts = None
    if self.parts is not None:
      parts = []
      for part in self.parts:
        parts.append( part.toDB() )

    data = {
      'id': self.id,
      'filename': self.filename,
      'channel': self.channel,
      'parts': parts,
      'parentfolder': self.parentfolder,
      'type': self.type,
      'info': self.info,
      'content': self.content if not for_web else None,
      'state': self.state,
      'ctime': self.ctime if not for_web else self.ctime.timestamp(),
      'mtime': self.mtime if not for_web else self.ctime.timestamp()
    }
    if for_web:
      data['content_length'] = self.content_length()
    
    return data

class TGFolder(TGItem):

  def __init__(self, id = '', filename = '', channel = None, parentfolder = '', info = {}, state = 'ACTIVE', ctime = None, mtime = None):
    self.id = id
    self.filename = filename
    self.channel = channel
    self.parts = None
    self.parentfolder = parentfolder
    self.type = 'folder'
    self.info = info
    self.content = None
    self.state = state or 'ACTIVE'

    self.ctime = ctime or NOW()
    self.mtime = mtime or NOW()
  

class TGFile(TGItem):
  def __init__(self, id = '', filename = '', channel = '', parts: list[TGPart] | None = None, parentfolder = '', type = '', info = {}, content: bytes | None = None, state = 'ACTIVE', ctime = None, mtime = None):
    self.id = id
    self.filename = filename
    self.channel = channel
    self.parts = parts
    self.parentfolder = parentfolder
    self.type = type
    self.info = info
    self.content = content
    self.state = state or 'ACTIVE'

    self.ctime = ctime or NOW()
    self.mtime = mtime or NOW()
  

def addEvent(fn):
  FN_CALLBACK.append(fn)

def init_database():
  Log.info(f"init database")

  global mongo
  mongo = MongoClient( Config.db )
  dbname = urlparse(Config.db)

  global database
  database = mongo[ dbname.path[1:] ]

  create_collections(database)

  check_transaction()

  global DB
  DB = database['entries']

  global TGDB
  TGDB = database['tgsessions']

  Log.info('database is ready!')

  rootfolder = getItem( ROOT_ID )
  if rootfolder is None:
    # create folder
    Log.info('creating ROOT folder')
    fld = TGFolder()
    fld.id = ROOT_ID
    fld.channel = Config.telegram.upload.channel
    fld.filename = ROOT_NAME
    create_folder(fld, None )

  listen()


def close_connection():
  mongo.close()

def start_session():
  session = mongo.start_session()
  transaction = session.start_transaction()
  return (session, transaction)


def remap(ret):
  if type(ret) == TGFile or type(ret) == TGFolder:
    return remap(ret.toDB())
  
  item = TGFolder()
  if ret['type'] != 'folder':
    item = TGFile()
  
  item.id = ret['id'] if 'id' in ret else None
  item.filename = ret['filename']
  item.channel = ret['channel'] if 'channel' in ret else None
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
  item.parentfolder = ret['parentfolder'] if 'parentfolder' in ret else None
  item.type = ret['type']
  item.info = ret['info'] if 'info' in ret else {}
  item.content = ret['content'] if 'content' in ret else None
  item.state = ret['state']

  if 'path' in ret:
    coll = {}
    for p in ret['path']:
      pFolder = remap(p)
      coll[ pFolder.id ] = pFolder
    
    paths = []
    pf_id = item.parentfolder
    while pf_id and len(coll) > 0:
      p = coll[ pf_id ]
      del coll[ pf_id ]
      paths.append( p )
      pf_id = p.parentfolder
    
    item.path = paths

  return item


def getItem(id, state = 'ACTIVE', session = None):
  filter = {'id': id}
  if state is not None:
    filter['state'] = state

  ret = DB.find_one(filter, session= session)

  if ret is not None:
    return remap(ret)

def getChildren(folderId, type = None, state = 'ACTIVE', ordered = False, session= None):
  filter = {
    'parentfolder': folderId
  }

  if state is not None:
    filter['state'] = state

  if type is not None:
    filter['type'] = type

  ret = DB.find(filter, session= session)

  if ordered:
    ret = ret.sort({'filename': 1})

  res = []
  for item in ret:
    res.append( remap(item) )

  return res

def removeItem(itemId, session = None):
  if itemId == ROOT_ID:
    raise Exception('Cannot remote root folder')

  item = getItem(itemId, session= session)

  if item.type == 'folder':
    list = raw_list_items_in_folder(item.id, session= session)
    ids = []
    for it in list:
      ids.append(it['id'])
    ret = DB.update_many({'$in': ids}, { '$set': {'state': 'DELETED'} }, session = session)
  else:
    # ret = DB.delete_one({'id': itemId}, session = session)
    ret = DB.update_one({'id': itemId}, { '$set': {'state': 'DELETED'} }, session = session)
  return ret

def purgeItem(itemId, session = None):
  if itemId == ROOT_ID:
    raise Exception('Cannot remote root folder')

  item = getItem(itemId, 'DELETED', session= session)

  if item.type == 'folder':
    list = raw_list_items_in_folder(item.id, session= session)
    ids = []
    for it in list:
      ids.append(it['id'])
    ret = DB.delete_many({'$in': ids}, session = session)
  else:
    # ret = DB.delete_one({'id': itemId}, session = session)
    ret = DB.delete_one({'id': itemId}, session = session)
  
  return ret


def getItemByFilename(filename: str, parent: str = None, type: str = None, state = 'ACTIVE', session= None):
  filter = {}
  if parent is not None: 
    filter['parentfolder'] = parent
  
  fn = re.sub("/", "-", filename) #, flags=re.IGNORECASE)
  filter['filename'] = fn

  if state is not None:
    filter['state'] = state

  if type is not None:
    filter['type'] = type

  if parent is not None:
    ret = DB.find(filter, session= session).collation( { 'locale': 'en', 'strength': 1 } )
    for item in ret:
      # get first item
      return remap(item)
  else:
    ret = DB.find(filter, session= session)
    res = []
    for item in ret:
      res.append( remap(item) )


def check_exist(filename, parent, type = None, id = None, session= None):
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

  ret = DB.count_documents(filter, session= session)
  return ret > 0



def create_folder(folder: TGFolder, parent = None, session = None):
  
  # check existing
  if check_exist(folder.filename, parent or folder.parentfolder, 'folder', session= session):
    raise Exception(f"Folder '{folder.filename}' already exists in '{parent}'")

  # return await this.write( async () => {

  fn = re.sub("/", "-", folder.filename, flags=re.IGNORECASE)

  folder.type = 'folder'
  folder.filename = fn
  folder.parentfolder = parent or folder.parentfolder
  folder.state = folder.state or 'ACTIVE'
  folder.parts = None
  folder.content = None

  folder.ctime = NOW()
  folder.mtime = NOW()

  if not folder.id:
    folder.id = get_UUID()

  ret = DB.insert_one( folder.toDB() , session = session)

  if folder.parentfolder:
    # update timestamps
    pfolder = getItem( folder.parentfolder, session= session )
    pfolder.mtime = NOW()
    update_folder(pfolder, pfolder, session= session)

  # faster than getItem
  obj = DB.find_one({'_id': ret.inserted_id}, session= session)
  return remap( obj )



def update_folder(folder: TGFolder, data: TGFolder, parent = None, session = None):
    # check existing
  if check_exist(data.filename, parent or data.parentfolder or folder.parentfolder, 'folder', data.id or folder.id):
    raise Exception(f"Folder '{data.filename}' already exists in '{parent}'")
  
  if not folder.id:
    raise Exception(f"Cannot update folder without id")

  # const oldFold = this.remap(folder);
  fn = re.sub("/", "-", data.filename or folder.filename, flags=re.IGNORECASE)

  folder.type = 'folder'
  folder.filename = fn
  folder.parentfolder = parent or data.parentfolder or folder.parentfolder
  folder.state = data.state or folder.state or 'ACTIVE'

  # we can modify relative channel for this folder
  folder.channel = data.channel if data.channel is not None else folder.channel
  
  ret = DB.update_one({'id': folder.id}, {'$set': folder.toDB()}, session = session)
  return getItem(folder.id, session= session)


def create_file(file: TGFile, parent = None, session = None):
  
  # check existing
  if check_exist(file.filename, parent or file.parentfolder, file.type):
    raise Exception(f"File '{file.filename}' already exists in '{parent}'")

  if (not file.content or file.content_length() <= 0) and not file.channel:
    raise Exception(f"File {file.filename} has no channel")
  
  _parent_folder = getItem(parent or file.parentfolder)
  if _parent_folder is None:
    raise Exception("specify parent folder")

  if _parent_folder.is_deleted():
    raise Exception(f"parent folder {_parent_folder.filename} is deleted")
    
  fn = re.sub("/", "-", file.filename, flags=re.IGNORECASE)
  file.filename = fn
  file.parentfolder = parent or file.parentfolder
  file.type = file.type or 'application/octet-stream'
  file.state = file.state or 'ACTIVE'

  file.ctime = NOW()
  file.mtime = NOW()

  if file.content is not None:
    if type( file.content ) is not bytes:
      file.content = base64.b64decode( file.content )
  
  if not file.id:
    file.id = get_UUID()
    
  ret = DB.insert_one( file.toDB(), session= session )

  if file.parentfolder:
    # update timestamps
    pfolder = getItem( file.parentfolder, session= session )
    pfolder.mtime = NOW()
    update_folder(pfolder, pfolder, session= session)

  # faster than getItem
  obj = DB.find_one({'_id': ret.inserted_id}, session= session)
  return remap( obj )


def update_file(file: TGFile, data: TGFile, parent = None, session = None):
  # check existing
  if check_exist(data.filename, parent or data.parentfolder or file.parentfolder, file.type, file.id):
    raise Exception(f"`File '{file.filename}' already exists in '{parent}'")

  if not file.id:
    raise Exception(f"Cannot update file without id")

  insert = data.toDB()
  insert['id'] = file.id

  fn = re.sub("/", "-", data.filename or file.filename, flags=re.IGNORECASE)

  insert['type'] = data.type or file.type or 'application/octet-stream'
  insert['filename'] = fn
  insert['parentfolder'] = parent or data.parentfolder or file.parentfolder
  insert['state'] = data.state or file.state or 'ACTIVE'
  insert['channel'] = data.channel if data.channel is not None else file.channel

  insert['mtime'] = NOW()

  if data.content:
    if type( data.content ) is not bytes:
      insert['content'] = base64.b64decode(data.content)
    else:
      insert['content'] = data.content

  Log.debug(f"updating file into DB: {insert['id']} - {insert}")
  DB.update_one({'id': insert['id']}, { '$set': insert}, session = session)

  return getItem(insert['id'], session= session)


def get_file_by_message_id_and_channel(msgId: int, channel: str, session= None):
  filter = {
    'type': { '$not': { '$eq': 'folder' } },
    'channel': channel,
    'state': { '$not': { '$eq': 'TEMP' } },
    'parts.0': { '$exists': True },
    'parts.messageid': msgId
  }
  ret = DB.find_one(filter, session= session)
  if ret is not None:
    return remap(ret)

def get_folders_by_channel(channelId: str, session= None):
  filter = {
    'type': 'folder',
    'channel': channelId
  }
  ret = DB.find(filter, session= session)
  res = []
  for item in ret:
    res.append( remap(item) )
  return res


def save_tg_session(key, value):
  already_exist = TGDB.find_one({'name': key})
  if already_exist is not None:
    TGDB.update_one({'name': key}, {'$set': {'name': key, 'value': value}})
  else:
    TGDB.insert_one({'name': key, 'value': value})

def get_tg_session(key):
  already_exist = TGDB.find_one({'name': key})
  if already_exist is not None:
    return already_exist['value']

  return None


def get_UUID():
  alphabet = string.ascii_lowercase + string.digits
  return ''.join( random.choices(alphabet, k=10) )


def create_collections(database):
  try:

    database.create_collection('entries', validator={
      '$jsonSchema': {
            'bsonType': 'object',
            'additionalProperties': True,

            'required': ['id', 'filename', 'type', 'state'],
            'properties': {
                'id': {
                  'bsonType': 'string',
                  'description': 'the unique custom ID'
                },
                'filename': {
                  'bsonType': 'string',
                  'description': 'the file or folder name'
                },
                'type': {
                  'bsonType': 'string',
                  'description': 'identify folder or mimetype'
                },
                'state': {
                  'bsonType': 'string',
                  'description': 'values: active, temp, deleted'
                }
            }
        }
    })
    coll = database['entries']

    coll.create_index(("id", TEXT), unique=True)
    coll.create_index( ('filename', TEXT) )
    coll.create_index( ('parentfolder', TEXT) )
    
  except Exception as e:
    Log.warn(f"error occurred while create schema for entries")
    Log.warn(e)
  

  try:

    database.create_collection('tgsessions')
    
  except Exception as e:
    Log.warn(f"error occurred while create schema for tgsessions")
    Log.warn(e)

def check_transaction():

  global CAN_TRANSACTION
  CAN_TRANSACTION = False
  
  try:
    session = mongo.start_session()
    transaction = session.start_transaction()

    with transaction:
      Log.debug('check transaction')
    CAN_TRANSACTION = True

  except Exception as e:
    CAN_TRANSACTION = False


def raw_list_items_in_folder(parent = ROOT_ID, skip_files = False, skip_folders = False, ordered = False, state = None, level = 0, session= None):
  aggregation = []
  if ( skip_files ):
    aggregation.append({
      '$match': {
        'type': {
          '$eq': 'folder'
        }
      }
    })
  
  if ( skip_folders ):
    aggregation.append({
      '$match': {
        'type': {
          '$not': {
            '$eq': 'folder'
          }
        }
      }
    })
  

  lookupData = { 
    'from': 'entries', 
    'startWith': '$parentfolder', 
    'connectFromField': 'parentfolder', 
    'connectToField': 'id', 
    'as': 'path'
  }

  if level > 0:
    lookupData['maxDepth'] = level

  aggregation.append({
    '$graphLookup': lookupData
  })

  if ( parent is not None and parent != ROOT_ID ):
    aggregation.append({
      '$match': {
        'path.id': parent
      }
    })
  
  
  
  if state is not None:
    aggregation.append({
      '$match': {
        'path.state': state
      }
    })
    aggregation.append({
      '$match': {
        'state': state
      }
    })
  
  if ordered:
    aggregation.append({
      '$sort': {
        'filename': 1
      }
    })

  ret = DB.aggregate(aggregation, session= session)
  return ret


def list_file_in_folder_recursively(parent = ROOT_ID, skip_files = False, skip_folders = False, ordered = False, state = None, level = 0, session= None):

  ret = raw_list_items_in_folder(parent, skip_files, skip_folders, ordered, state, level, session)
  
  result = []
  for i in ret:
    item = remap(i)
    if item.path:
      item.path.reverse()
    result.append( item ) 
  return result


def listen():
  listen_task = threading.Thread(target=watch_changes)
  listen_task.start()

def watch_changes():
  with DB.watch() as stream:
    while stream.alive:
        change = stream.try_next()
        # Note that the ChangeStream's resume token may be updated
        # even when no changes are returned.
        Log.debug(f"Current resume token: {stream.resume_token}")
        if change is not None:
            Log.info(f"Change document: {change}")
            for fn in FN_CALLBACK:
              fn(
                change['operationType'],
                remap(change['fullDocument']),
                str(change['fullDocument']['_id'])
              )
            continue
        # We end up here when there are no recent changes.
        # Sleep for a while before trying again to avoid flooding
        # the server with getMore requests when no changes are
        # available.
        time.sleep(5)