from pymongo import MongoClient, TEXT
import datetime
import traceback
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
  return datetime.datetime.now(datetime.timezone.utc)


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

  def is_on_telegram(self):
    return self.content is None or self.content_length() == 0 and self.parts is not None and len(self.parts) > 0


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

  def clone(self):

    newitem = None
    if type(self) == TGFile:
      newitem = TGFile()
    elif type(self) == TGFolder:
      newitem = TGFolder()

    newitem.id = self.id
    newitem.filename = self.filename
    newitem.channel = self.channel

    if self.parts:
      # loop parts
      newparts = []
      for part in self.parts:
        newparts.append(TGPart(
          messageid = part.messageid,
          originalfilename = part.originalfilename,
          fileid = part.fileid,
          size = part.size,
          index = part.index,
          hash = part.hash
        ))
      newitem.parts = newparts

    newitem.parentfolder = self.parentfolder
    newitem.type = self.type
    newitem.info = self.info
    newitem.content = self.content
    newitem.state = self.state
    newitem.ctime = self.ctime
    newitem.mtime = self.mtime

    if self.path:
      # loop path
      newpaths = []
      for path in self.path:
        newpaths.append(TGFolder(
          id = path.id,
          filename = path.filename,
          channel = path.channel,
          parentfolder = path.parentfolder,
          info = path.info,
          state = path.state,
          ctime = path.ctime,
          mtime = path.mtime
        ))
      newitem.path = newpaths

    return newitem

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

  # listen()


def close_connection():
  if mongo is not None:
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
    collpath = []
    for p in ret['path']:
      pFolder = remap(p)
      collpath.append( pFolder )

    # paths = []
    # pf_id = item.parentfolder
    # while pf_id and len(coll) > 0:
    #   p = coll[ pf_id ]
    #   del coll[ pf_id ]
    #   paths.append( p )
    #   pf_id = p.parentfolder

    item.path = collpath

  return item


def _getItem(id, state = 'ACTIVE', session = None):
  filter = {'id': id}
  if state is not None:
    filter['state'] = state

  ret = DB.find_one(filter, session= session)

  if ret is not None:
    return remap(ret)

def getItem(id, state = 'ACTIVE', session = None):

  items = raw_list_items_in_folder(itemId = id, state = state, session= session)

  if items._has_next() > 0:
    return remap( items.next() )

  return None

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
    raise Exception('Cannot remove root folder')

  # item = getItem(itemId, session= session)

  # if item.type == 'folder':
  #   list = raw_list_items_in_folder(item.id, session= session)
  #   ids = []
  #   for it in list:
  #     ids.append(it['id'])
  #   ret = DB.update_many({'id': {'$in': ids}}, { '$set': {'state': 'DELETED'} }, session = session)
  # else:
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
    ret = DB.delete_many({'id': {'$in': ids}}, session = session)
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


def check_exist(filename, parent, type = None, id = None, state= 'ACTIVE', session= None):

  # TODO: check filename with IGNORECASE
  # fn = re.sub("/", "-", filename, flags=re.IGNORECASE)
  # fn = re.sub("(", "\\(", filename, flags=re.IGNORECASE)
  # fn = re.sub(")", "\)", filename, flags=re.IGNORECASE)

  # regexp = re.compile( f"^{fn}", re.IGNORECASE)
  filter = {
    "filename": filename,
    "parentfolder": parent
  }

  if id is not None:
    # suppose 'modify' action
    filter['id'] = {'$not': { '$eq': id}}

  if type is not None:
    filter['type'] = type

  # TODO: check state control
  filter['state'] = state

  ret = DB.count_documents(filter, session= session)
  return ret > 0



def create_folder(folder: TGFolder, parent = None, session = None):

  # check existing
  if check_exist(filename= folder.filename, parent= parent or folder.parentfolder, type= 'folder', state= folder.state, session= session):
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



def update_folder(oldfolder: TGFolder, data: TGFolder, parent = None, session = None):
    # check existing
  if check_exist(
      filename= data.filename or oldfolder.filename,
      parent= parent or data.parentfolder or oldfolder.parentfolder,
      type= 'folder',
      id= data.id or oldfolder.id,
      state= data.state or oldfolder.state,
      session= session
    ):
    raise Exception(f"Folder '{data.filename}' already exists in '{parent}'")

  if not oldfolder.id:
    raise Exception(f"Cannot update folder without id")

  # const oldFold = this.remap(folder);
  fn = re.sub("/", "-", data.filename or oldfolder.filename, flags=re.IGNORECASE)

  oldfolder.type = 'folder'
  oldfolder.filename = fn
  oldfolder.parentfolder = parent or data.parentfolder or oldfolder.parentfolder
  oldfolder.state = data.state or oldfolder.state or 'ACTIVE'

  # we can modify relative channel for this folder
  oldfolder.channel = data.channel if data.channel is not None else oldfolder.channel

  ret = DB.update_one({'id': oldfolder.id}, {'$set': oldfolder.toDB()}, session = session)
  return getItem(oldfolder.id, session= session)


def create_file(file: TGFile, parent = None, session = None):

  # check existing
  if check_exist(filename= file.filename, parent= parent or file.parentfolder, type= file.type, state= file.state, session= session):
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


def update_file(oldfile: TGFile, data: TGFile, parent = None, session = None):
  # check existing
  if check_exist(
      filename= data.filename or oldfile.filename,
      parent= parent or data.parentfolder or oldfile.parentfolder,
      type= data.type or oldfile.type,
      id= oldfile.id,
      state= data.state or oldfile.state,
      session= session
    ):
    raise Exception(f"`File '{data.filename or oldfile.filename}' already exists in '{parent or data.parentfolder or oldfile.parentfolder}'")

  if not oldfile.id:
    raise Exception(f"Cannot update file without id")

  insert = data.toDB()
  insert['id'] = oldfile.id

  fn = re.sub("/", "-", data.filename or oldfile.filename, flags=re.IGNORECASE)

  insert['type'] = data.type or oldfile.type or 'application/octet-stream'
  insert['filename'] = fn
  insert['parentfolder'] = parent or data.parentfolder or oldfile.parentfolder
  insert['state'] = data.state or oldfile.state or 'ACTIVE'
  insert['channel'] = data.channel if data.channel is not None else oldfile.channel

  insert['mtime'] = NOW()

  if data.content:
    if type( data.content ) is not bytes:
      insert['content'] = base64.b64decode(data.content)
    else:
      insert['content'] = data.content

  # TODO: check if pass content or inherit from original file
  # elif file.content:
  #   insert['content'] = file.content

  elif data.parts is None:
    if oldfile.parts is not None:
      insert['parts'] = []
      for p in oldfile.parts:
        insert['parts'].append(p.toDB())

      # force reset the original channel, in case of 'rename' from WEbUI
      # WebUI set `channel` to empty string: this resets the channel in DB
      insert['channel'] = data.channel or oldfile.channel

  Log.debug(f"updating file into DB: {insert['id']} - {insert}")
  DB.update_one({'id': insert['id']}, { '$set': insert}, session= session)

  return getItem(insert['id'], session= session)


def get_file_by_message_id_and_channel(msgId: int, channel: str, state = None, session= None):
  filter = {
    'type': { '$not': { '$eq': 'folder' } },
    'channel': channel,
    'parts.0': { '$exists': True },
    'parts.messageid': msgId
  }

  if state is not None:
    filter['state'] = state

  ret = DB.find_one(filter, session= session)
  if ret is not None:
    return remap(ret)

def get_file_by_filename_and_channel(filename: str, channel: str, msgid: int = None, session= None):

  fn = re.sub("/", "-", filename, flags=re.IGNORECASE)
  regexp = re.compile( f"^{fn}", re.IGNORECASE)

  filter = {
    'type': { '$not': { '$eq': 'folder' } },
    'channel': channel,
    'state': { '$not': { '$eq': 'TEMP' } },
    'filename': regexp
  }

  if msgid is not None:
    filter['parts.0'] = { '$exists': True }
    filter['parts.messageid'] = msgid


  ret = DB.find_one(filter, session= session)
  if ret is not None:
    return remap(ret)
  pass

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
                  'description': 'identify `folder` or file mimetype'
                },
                'state': {
                  'bsonType': 'string',
                  'description': 'values: ACTIVE, TEMP, DELETED'
                }
            }
        }
    })
  except Exception as e:
    Log.warning(f"error occurred while creating schema for entries")
    Log.warning(e)

  try:
    coll = database['entries']

    coll.create_index( ("id", TEXT), unique=True)
    coll.create_index( ('filename', TEXT) )
    coll.create_index( ('parentfolder', TEXT) )
    coll.create_index( ['filename', 'parentfolder', 'state'] )

  except Exception as e:
    Log.warning(f"error occurred while creating indexes for entries")
    Log.warning(e)


  try:

    database.create_collection('tgsessions')

  except Exception as e:
    Log.warning(f"error occurred while create schema for tgsessions")
    Log.warning(e)

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


def raw_list_items_in_folder(parent = ROOT_ID, itemId = None, skip_files = False, skip_folders = False, state = None, level = None, session= None):
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
    'depthField': "level",
    'as': 'path'
  }

  if level is not None:
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

  if itemId is not None:
    aggregation.append({
      '$match': {
        'id': itemId
      }
    })

  if state is not None and itemId != ROOT_ID:
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

  aggregation.append({
    '$unwind': {
      'path': "$path",
      'preserveNullAndEmptyArrays': True
    }
  })

  aggregation.append({
    '$sort': { "path.level": -1 }
  })

  aggregation.append({
    '$group': {
      '_id': "$_id",
      'id': { '$first': '$id' },
      'filename': { '$first': '$filename' },
      'channel': { '$first': '$channel' },
      'parts': { '$first': '$parts' },
      'parentfolder': { '$first': '$parentfolder' },
      'type': { '$first': '$type' },
      'info': { '$first': '$info' },
      'content': { '$first': '$content' },
      'state': { '$first': '$state' },
      'ctime': { '$first': '$ctime' },
      'mtime': { '$first': '$mtime' },
      'path': { '$push': "$path" }
    }
  })

  aggregation.append({
    '$sort': {
      'filename': 1
    }
  })

  ret = DB.aggregate(aggregation, session= session)
  return ret


def list_file_in_folder_recursively(parent = ROOT_ID, skip_files = False, skip_folders = False, state = None, level= None, session= None):

  ret = raw_list_items_in_folder(parent= parent, skip_files= skip_files, skip_folders= skip_folders, state= state, level= level, session= session)

  result = []
  for i in ret:
    item = remap(i)
    # if item.path:
    #   item.path.reverse()
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

            Log.debug("---")
            Log.debug(f"Change document: {change}")
            Log.debug("---")

            if not 'fullDocument' in change:
              Log.warning(f"changes have not 'fullDocument'")
              continue

            for fn in FN_CALLBACK:
              try:
                fn(
                  change['operationType'],
                  remap(change['fullDocument']),
                  str(change['fullDocument']['_id'])
                )
              except Exception as e:
                Log.error(f"Error while handling changes")
                traceback.print_exc()
                Log.error(e, exc_info=True)
            continue
        # We end up here when there are no recent changes.
        # Sleep for a while before trying again to avoid flooding
        # the server with getMore requests when no changes are
        # available.
        time.sleep(5)