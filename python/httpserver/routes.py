from aiohttp import web
from services.database import TGFile, getItem, getItemByFilename
from constants import ROOT_ID
from services.fsapi import FSApi as FSApiLib
import logging


Log = logging.getLogger("WebRoutes")


routes = web.RouteTableDef()

root = getItem(ROOT_ID)
FSApi = FSApiLib(root)

@routes.get(r"/files/{file_id}")
async def download_file(request: web.Request):

  Log.info('Got download request')
  file_id = request.match_info["file_id"]

  Log.info(f"file requested is: {file_id}")

  dbFile = getItem(file_id)

  if dbFile is None:
    Log.info(f"item not found in db {file_id}")
    raise Exception(f"invalid file id: {file_id}")


  if dbFile.type == 'folder':
    Log.error(f"requested item is a folder {dbFile.id}")
    raise Exception(f"requested item is a folder {dbFile.id}")
  
  # parse Range header

  totalsize = 0

  if dbFile.content is not None:
    totalsize = len( dbFile.content )
  else:
    for part in dbFile.parts:
      totalsize += part.size

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
  
    except ConnectionResetError:
      service.stop()
      Log.warn("connection aborted")
    
  
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
          Log.warn("connection aborted")

  
  return web.Response(
    status=422,
    body="Cannot handle file upload"
  )