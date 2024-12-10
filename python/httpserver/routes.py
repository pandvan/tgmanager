import os
from aiohttp import web
import mimetypes
from services.database import TGFile, TGFolder, start_session, getItem, getItemByFilename, update_file, removeItem, update_folder
from constants import ROOT_ID
from services.fsapi import FSApi as FSApiLib
from configuration import CWD
import logging


Log = logging.getLogger("WebRoutes")


routes = web.RouteTableDef()

root = getItem(ROOT_ID)
FSApi = FSApiLib(root)

@routes.get("/")
@routes.get("/index")
@routes.get("/index.html")
async def homepage(request: web.Request):
  return web.FileResponse( os.path.join(CWD, 'public/index.html') )


@routes.get(r"/folders/{fld_id}")
async def get_folder(request: web.Request):
  fld_id = request.match_info["fld_id"]

  if not fld_id:
    Log.error(f"invalid folder id")
    return web.Response(
      status=400,
      body=f"invalid folder id"
    )

  folder = getItem(fld_id)
  if not folder or folder.type != 'folder':
    Log.error(f"invalid folder id")
    return web.Response(
      status=422,
      body=f"requested item is not a folder"
    )

  path = FSApiLib.build_path(folder)
  children = await FSApi.list_dir(path);


  items = []
  for item in children[1:]:
    items.append( item.toDB(True) )
  return web.json_response( items )

@routes.post(r"/folders/{fld_id}/folder/{foldername}")
@routes.post(r"/folders/{fld_id}/folder/")
@routes.post(r"/folders/{fld_id}/folder")
async def create_folder(request: web.Request):

  fld_id = request.match_info["fld_id"]

  if not fld_id:
    Log.error(f"invalid parent folder id")
    return web.Response(
      status=400,
      body=f"invalid parent folder id"
    )

  parentfolder = getItem(fld_id)
  if not parentfolder or parentfolder.type != 'folder':
    Log.error(f"invalid parent folder id")
    return web.Response(
      status=422,
      body=f"requested item is not a valid parent folder"
    )

  data = {}
  
  try:
    data = await request.json()
  except Exception as E:
    pass
  
  foldername = request.match_info["foldername"]
  if not foldername:
    if 'foldername' in data:
      foldername = data['foldername']
    if not foldername:
      return web.Response(
        status=422,
        body="foldername is missing"
      )
  
  path = FSApiLib.build_path(parentfolder)
  folder_path = path + '/' + foldername
  new_folder = await FSApi.create(folder_path, True)

  return web.Response(
    status=201,
    body=f"folder created: {new_folder.id}"
  )



@routes.get(r"/files/{file_id}")
async def download_file(request: web.Request):

  Log.info('Got download request')
  file_id = request.match_info["file_id"]

  Log.info(f"file requested is: {file_id}")

  dbFile = getItem(file_id)

  if dbFile is None:
    Log.info(f"item not found in db {file_id}")
    return web.Response(
      status=404,
      body=f"file is missing with the id {file_id}"
    )


  if dbFile.type == 'folder':
    Log.error(f"requested item is a folder {dbFile.id}")
    return web.Response(
      status=422,
      body=f"requested item is not a file"
    )
  
  # parse Range header

  totalsize = 0

  if dbFile.content is not None:
    totalsize = len( dbFile.content )
  elif dbFile.parts:
    for part in dbFile.parts:
      totalsize += part.size
  else:
    Log.error(f"cannot serve file caused by no content nor parts: {dbFile.toDB()}")
    return web.Response(
      status=422,
      body=f"file is not a valid file"
    )

  totalsize = int(totalsize)

  range_header = request.headers.get("Range", 0)

  if range_header:
    start, end = range_header.replace("bytes=", "").split("-")
    start = int(start)
    end = int(end) if end else totalsize - 1
  else:
    start = request.http_range.start or 0
    end = (request.http_range.stop or totalsize) - 1
  
  path = FSApiLib.build_path(dbFile)

  stream = web.StreamResponse(
    status=206 if range_header else 200,
    headers={
      "Content-Type": f"{dbFile.type}",
      "Content-Range": f"bytes {start}-{end}/{totalsize}",
      "Content-Length": str((end - start) + 1),
      "Content-Disposition": f"inline; filename=\"{dbFile.filename}\"",
      "Accept-Ranges": "bytes",
    },
  )

  await stream.prepare(request)

  service = await FSApi.read_file_content(path, start, end)

  if service:
    try:

      await service.execute( stream, True )
      return
  
    except ConnectionResetError:
      service.stop()
      Log.warn("connection aborted")
      return
    
  
  return web.Response(
    status=422,
    body="something went wrong"
  )


@routes.post(r"/folders/{fldid}/files/{filename}")
@routes.post(r"/folders/{fldid}/files/")
@routes.post(r"/folders/{fldid}/files")
async def upload_file(request: web.Request):
  fldid = request.match_info['fldid']

  post = await request.post()
  for key, item in post.items():
    is_file = getattr(item, 'filename', False)
    if is_file is not False:
      # found file part to upload
      filename = None
      if 'filename' in request.match_info:
        filename = request.match_info["filename"]
      
      filename = filename or item.filename

      if not filename:
        return web.Response(
          status=422,
          body="filename is missing"
        )

      parent = getItem(fldid)
      if parent is None or parent.type != 'folder':
        return web.Response(
          status=422,
          body="invalid parent folder specified"
        )

      path = FSApiLib.build_path(parent)

      file_path = path + '/' + filename

      service = await FSApi.create_file_with_content(file_path)

      if service:
        try:
          await service.execute(item.file)
      
          return web.Response(
            status=201,
            body=f"File has been correctly created in '{parent.filename}'"
          )
      
        except ConnectionResetError:
          service.stop()
          Log.warning("connection aborted")
          return

  
  return web.Response(
    status=422,
    body="Cannot handle file upload"
  )

@routes.delete(r"/folders/{fld_id}")
async def delete_folder(request: web.Request):

  fld_id = request.match_info["fld_id"]

  if not fld_id:
    Log.error(f"invalid folder id")
    return web.Response(
      status=400,
      body=f"invalid folder id"
    )

  folder = getItem(fld_id)
  if not folder or folder.type != 'folder':
    Log.error(f"invalid folder id")
    return web.Response(
      status=422,
      body=f"requested item is not a valid folder"
    )
  

  path = FSApiLib.build_path(folder);

  try:

    await FSApi.delete(path, False)

    return web.Response(
      status=204,
      body=f"folder has been delete"
    )

  except Exception as e:
    Log.error(e)
    return web.Response(
      status=422,
      body=f"{e}"
    )


@routes.delete(r"/files/{file_id}")
async def delete_file(request: web.Request):
  file_id = request.match_info["file_id"]

  Log.info(f"file to be removed is: {file_id}")

  dbFile = getItem(file_id)

  if dbFile is None:
    Log.info(f"item not found in db {file_id}")
    return web.Response(
      status=404,
      body=f"file not exists with the id {file_id}"
    )


  if dbFile.type == 'folder':
    Log.error(f"requested item is a folder {dbFile.id}")
    return web.Response(
      status=422,
      body=f"requested item is not a file"
    )

  try:
    path = FSApiLib.build_path(dbFile)

    await FSApi.delete(path)

    return web.Response(
      status=204,
      body=f"file deleted"
    )

  except Exception as e:
    Log.error(e)
    return web.Response(
      status=422,
      body=f"{e}"
    )



@routes.put(r"/files/{file_id}/merge")
async def merge_file(request: web.Request):

  file_id = request.match_info["file_id"]

  Log.info(f"file to be merge into is: {file_id}")

  dbFile = getItem(file_id)

  if dbFile is None:
    Log.info(f"item not found in db {file_id}")
    return web.Response(
      status=404,
      body=f"file not exists with the id {file_id}"
    )


  if dbFile.type == 'folder':
    Log.error(f"requested item is a folder {dbFile.id}")
    return web.Response(
      status=422,
      body=f"requested item is not a file"
    )

  if dbFile.content is not None and dbFile.parts is None:
    Log.error(f"cannot merge local DB")
    return web.Response(
      status=422,
      body=f"cannot merge local DB file"
    )

  part_ids = request.rel_url.query.get('part_ids', '')

  if not part_ids:
    Log.error(f"invalid part ids {part_ids}")
    return web.Response(
      status=422,
      body=f"invalid part ids {part_ids}"
    )
  
  part_ids = part_ids.split(',')

  for part_id in part_ids:
    dbPart = getItem(part_id)
    if ( not dbPart ):
      Log.error(f"Part not exists in db '{part_id}'")
      return web.Response(
        status=422,
        body=f"Part not exists in db '{part_id}'"
      )
    dbFile.parts = dbFile.parts + dbPart.parts

    update_file(dbFile, dbFile)

    removeItem(dbPart.id)
  
  # update parts indexes
  index = 0
  for part in dbFile.parts:
    part.index = index
    index += 1
  
  Log.info(f"corectly merge parts: '{dbFile.id}' -> '{part_ids}")
  
  return web.json_response( dbFile.toDB(True) )


@routes.put(r"/folders/{fld_id}")
async def rename_folder(request: web.Request):
  fld_id = request.match_info["fld_id"]

  if not fld_id:
    Log.error(f"invalid folder id")
    return web.Response(
      status=400,
      body=f"invalid folder id"
    )

  folder = getItem(fld_id)
  if not folder or folder.type != 'folder':
    Log.error(f"invalid folder id")
    return web.Response(
      status=422,
      body=f"requested item is not a folder"
    )

  data = {}
  try:
    data = await request.json()
  except Exception as E:
    pass

  newData = TGFolder(
    filename = data['filename'] if 'filename' in data and data['filename'] else folder.filename,
    channel = data['channel'] if 'channel' in data else folder.channel
  )

  newFolderData = update_folder(folder, newData)
  return web.json_response( newFolderData.toDB(True) )


@routes.put(r"/files/{file_id}")
async def rename_file(request: web.Request):

  file_id = request.match_info["file_id"]

  Log.info(f"file to be merge into is: {file_id}")

  dbFile = getItem(file_id)

  if dbFile is None:
    Log.info(f"item not found in db {file_id}")
    return web.Response(
      status=404,
      body=f"file not exists with the id {file_id}"
    )


  if dbFile.type == 'folder':
    Log.error(f"requested item is a folder {dbFile.id}")
    return web.Response(
      status=422,
      body=f"requested item is not a file"
    )

  data = await request.json()

  newfilename = data['filename'] if 'filename' in data and data['filename'] else dbFile.filename


  newData = TGFile(
    filename = newfilename,
    type = mimetypes.guess_type(newfilename)[0] or 'application/octet-stream'
  )

  newFileData = update_file(dbFile, newData)
  return web.json_response( newFileData.toDB(True) )


@routes.post(r"/folders/{fld_id}/move")
async def move_items_into_folder(request: web.Request):
  fld_id = request.match_info["fld_id"]

  if not fld_id:
    Log.error(f"no folder found with given ID: {fld_id}")
    return web.Response(
      status=400,
      body=f"invalid folder id"
    )

  folder = getItem(fld_id)
  if not folder or folder.type != 'folder':
    Log.error(f"specified ID is not folder or not exists")
    return web.Response(
      status=422,
      body=f"requested item is not a folder"
    )

  data = {}
  try:
    data = await request.json()
  except Exception as E:
    pass

  ids = data['items'] if 'items' in data else []

  (session, transaction) = start_session()

  with transaction:
    for id in ids:
      item = getItem(id, session= session)

      if item is not None:
        if item.type == 'folder':
          update_folder(item, item, parent = fld_id, session = session)
        else:
          update_file(item, item, fld_id, session = session)
      else:
        Log.warning(f"item not found with id: {id}")
  
  return web.json_response( {'ok': True} )


  

# @routes.post(r"/files/{file_id}/move/{fld_id}")
# async def move_file(request: web.Request):
#   pass

