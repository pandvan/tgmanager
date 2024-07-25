import os
import logging
from services.database import getItem, TGFolder
from constants import ROOT_ID
from services.fsapi import FSApi as FSApiLib

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


    await self.loop_folder(source_path, destination_folder)


  async def loop_folder(self, source_path: str, destination_folder: TGFolder):
    Log.info(f"loop folder {source_path}")
    for root, dirs, files in os.walk(source_path):
      
      for dirname in dirs:
        # Log.info(f"in loop folder {source_path}, {root}, {dirname}, {destination_folder.filename}")

        dirname_full_path = os.path.join(root, dirname)
        dirname_destination_path = dirname_full_path[ len(source_path) : ]

        f = self.fsapi.create_folder_recursive(dirname_destination_path, destination_folder.id )

        Log.info(f"'{f.id}' { FSApiLib.build_path(f) }")

      

      for filename in files:

        filename_full_path = os.path.join(root, filename)
        filename_destination_path = filename_full_path[ len(source_path) : ]

        destination_file_path = FSApiLib.build_path(destination_folder) + filename_destination_path

        Log.info(f"looping file '{filename_full_path}' in '{destination_file_path}'")

        service = await self.fsapi.create_file_with_content(destination_file_path)

        if service:
          Log.info(f"creating file {filename_full_path}")
          f = open( filename_full_path, 'rb' )
          await service.execute(f)

    