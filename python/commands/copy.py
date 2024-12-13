import os
import traceback
import logging
from services.database import getItem, TGFolder, raw_list_items_in_folder
from constants import ROOT_ID
from services.fsapi import FSApi as FSApiLib

Log = logging.getLogger('SYNC')

class Copy():

  fsapi = None

  def __init__(self):
    root = getItem(ROOT_ID)
    self.fsapi = FSApiLib( root )


  async def copy_command(self, Args):
    
    if not Args.copy_source:
      raise Exception("You must specify source folder")

    if not Args.copy_destination:
      raise Exception("You must specify destination folder")

    source_path = Args.copy_source
    destination = Args.copy_destination

    delete_original = Args.copy_delete_source is True

    dry_run = Args.copy_dry_run is True

    if not source_path.startswith('/'):
      source_path = f"/{source_path}"

    if not destination.startswith('/'):
      destination = f"/{destination}"
    
    Log.info(f"Copying from '{source_path}' to '{destination}'")

    sourceItem = self.fsapi.get_last_folder(source_path)

    if sourceItem is None:
      raise Exception(f"'{source_path}' not exists")
    
    destItem = self.fsapi.get_last_folder(destination)
    if destItem is None:
      destination_folder = self.fsapi.create_folder_recursive(destination)
    
    elif sourceItem.type == 'folder' and destItem.type != 'folder' :
      raise Exception(f"cannot copy the folder '{sourceItem.filename}' into file '{destItem.filename}'")

    # items_to_copy = []

    # if sourceItem.type == 'folder':
    #   # recursive copy
    #   items_to_copy = raw_list_items_in_folder(parent= sourceItem.id, skip_files= False, skip_folders= False, state= 'ACTIVE', level= None)

    # else:
    #   items_to_copy = [ sourceItem ]
    

    await self.fsapi.move_or_copy(source_path, destination, is_move= False)

    Log.info('Completed!')




  async def loop_folder(self, source_path: str, destination_folder: TGFolder, dry_run= False):
    Log.info(f"loop folder '{source_path}'")

    ret = []
    for root, dirs, files in os.walk(source_path):

      for filename in files:

        filename_full_path = os.path.join(root, filename)
        filename_destination_path = filename_full_path[ len(source_path) : ]

        if filename_destination_path.startswith('/'):
          filename_destination_path = filename_destination_path[1:]

        destination_file_path = os.path.join( FSApiLib.build_path(destination_folder), filename_destination_path )

        Log.debug(f"looping file '{filename_full_path}' in '{destination_file_path}'")

        item = self.fsapi.exists(destination_file_path, state = 'ACTIVE')
        if item is None:

          # TEMP: check without YEAR
          import re
          destination_file_path = re.sub("\\s\\(([0-9]{4})\\)\\s\\-\\sS", " - S", destination_file_path, flags=re.IGNORECASE)

          item = self.fsapi.exists(destination_file_path, state = 'ACTIVE')
          if item is None:

            # TEMP: also check with YEAR
            
            matchYear = re.search("(\\(\\d{4}\\))\\/Season \\d+\\/", destination_file_path)
            year = matchYear.groups()[0] if matchYear else None

            matchFilename = re.search( "\\-\\sS\\d+E\\d+\\s\\-" , filename )
            substitute = matchFilename.group() if matchFilename else None

            if year and substitute:
              destination_file_path = destination_file_path.replace( substitute, f"{year} {substitute}" )

              item = self.fsapi.exists(destination_file_path, state = 'ACTIVE')

              Log.debug(f"check: '{destination_file_path}'")

            if item is None:
              if dry_run:
                Log.info(f"'{filename_full_path}' may be processed, skip as per dry_run")
              else:
                Log.info( f"'{filename}' will be processed in '{destination_file_path}'")
                ret.append( (filename_full_path, destination_file_path ) )
          
        else:
          Log.debug(f"'{destination_file_path}' already exists -> '{item.id}'")
        
    return ret

  
  async def proceed_to_sync(self, file_list, delete_original= False):

    for file in file_list:
      try:
        await internal_task(file, delete_original= delete_original)
      except Exception as e:
        traceback.print_exc()
        Log.error(e, exc_info=True)


async def internal_task(item, delete_original= False):
  destination_file_path = item[1]
  filename_full_path = item[0]

  root = getItem(ROOT_ID)
  fsapi = FSApiLib( root )

  
  fsapi.create_folder_recursive(destination_file_path, skip_last = True)
  
  try:
    service = await fsapi.create_file_with_content(destination_file_path, stop_if_exists= True)
  except Exception as E:
    Log.error(E)
    Log.warning(f"'{destination_file_path}' cannot be synced due to: {E}")

  try:

    if service:
      stat = os.stat(filename_full_path)
      Log.info(f"'{destination_file_path}' not exists, creating... ({stat.st_size} bytes)")
      f = open( filename_full_path, 'rb' )
      await service.execute(f)
      f.close()
    if delete_original:
      os.remove(filename_full_path)

  except Exception as e:
    exists = fsapi.exists(destination_file_path)
    if exists:
      await fsapi.delete(destination_file_path)
    Log.warn(f"Error: {e}")