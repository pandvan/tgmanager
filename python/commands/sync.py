import os
import asyncio
import logging
from services.database import getItem, TGFolder
from constants import ROOT_ID
from services.fsapi import FSApi as FSApiLib
from multiprocessing.pool import ThreadPool

Log = logging.getLogger('SYNC')

class Sync():

  fsapi = None

  def __init__(self):
    root = getItem(ROOT_ID)
    self.fsapi = FSApiLib( root )


  async def sync_command(self, Args):
    
    if not Args.source:
      raise Exception("You must specify source folder")

    if not Args.destination:
      raise Exception("You must specify destination folder")

    if not os.path.exists( Args.source ) or not os.path.isdir(Args.source):
      raise Exception(f"Invalid source folder: '{Args.source}'")
  

    source_path = Args.source
    destination = Args.destination

    if not destination.startswith('/'):
      destination = f"/{destination}"
    
    destination_folder = self.fsapi.create_folder_recursive(destination)

    file_list = await self.loop_folder(source_path, destination_folder)

    Log.info(f"found {len(file_list)} files to sync")

    await self.proceed_to_sync( file_list )

    Log.info('Completed!')


  async def loop_folder(self, source_path: str, destination_folder: TGFolder):
    Log.info(f"loop folder '{source_path}'")

    ret = []
    for root, dirs, files in os.walk(source_path):

      # NO-needed: folders will be created while creating files
      
      # for dirname in dirs:
      #   # Log.info(f"in loop folder {source_path}, {root}, {dirname}, {destination_folder.filename}")

      #   dirname_full_path = os.path.join(root, dirname)
      #   dirname_destination_path = dirname_full_path[ len(source_path) : ]

      #   exists = self.fsapi.exists(dirname_destination_path, destination_folder.id)
      #   if not exists:
      #     f = self.fsapi.create_folder_recursive(dirname_destination_path, destination_folder.id )

      #     Log.info(f"folder created: '{f.id}' { FSApiLib.build_path(f) }")
      #   else:
      #     Log.debug(f"'{dirname_destination_path}' already exists")
      

      for filename in files:

        filename_full_path = os.path.join(root, filename)
        filename_destination_path = filename_full_path[ len(source_path) : ]

        destination_file_path = FSApiLib.build_path(destination_folder) + filename_destination_path

        Log.debug(f"looping file '{filename_full_path}' in '{destination_file_path}'")

        item = self.fsapi.exists(destination_file_path, state = 'ACTIVE')
        if item is None:

          ret.append( (filename_full_path, destination_file_path ) )
          
          # self.fsapi.create_folder_recursive(destination_file_path, skip_last = True)

          # service = await self.fsapi.create_file_with_content(destination_file_path)

          # if service:
          #   stat = os.stat(filename_full_path)
          #   Log.info(f"'{destination_file_path}' not exists, creating... ({stat.st_size} bytes)")
          #   f = open( filename_full_path, 'rb' )
          #   await service.execute(f)
          #   f.close()
        else:
          Log.debug(f"'{destination_file_path}' already exists -> '{item.id}'")
        
    return ret

  
  async def proceed_to_sync(self, file_list):

    # with ThreadPool(1) as pool:
    #   # call a function on each item in a list and handle results
    #   result = pool.map( task, file_list)
    #   result.wait()

    # Log.info(result)
    for file in file_list:
      await internal_task(file)


async def internal_task(item):
  destination_file_path = item[1]
  filename_full_path = item[0]

  root = getItem(ROOT_ID)
  fsapi = FSApiLib( root )

  try:

    fsapi.create_folder_recursive(destination_file_path, skip_last = True)

    service = await fsapi.create_file_with_content(destination_file_path)

    if service:
      stat = os.stat(filename_full_path)
      Log.info(f"'{destination_file_path}' not exists, creating... ({stat.st_size} bytes)")
      f = open( filename_full_path, 'rb' )
      await service.execute(f)
      f.close()
  except Exception as e:
    exists = fsapi.exists(destination_file_path)
    if exists:
      await fsapi.delete(destination_file_path)
    Log.warn(f"Error: {e}")