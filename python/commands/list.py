import logging
from services.database import getItem, list_file_in_folder_recursively
from constants import ROOT_ID
from services.fsapi import FSApi as FSApiLib

Log = logging.getLogger("List")

class ListFS():

  fsapi = None

  def __init__(self):
    root = getItem(ROOT_ID)
    self.fsapi = FSApiLib( root )
     

  async def listing(self, Args):
    start_folder = Args.list_start_folder
    if not start_folder:
      start_folder = ROOT_ID
      Log.info(f"listing all files and folder starting from ROOT directory")
    else:
      folder = self.fsapi.get_last_folder(start_folder)
      if folder is None:
        raise Exception(f"folder '{start_folder}' not found")
      if folder.type != 'folder':
        raise Exception(f"item '{start_folder}' is not folder")
      
      start_folder = folder.id
      Log.info(f"listing all files and folder starting from '{folder.filename}' ({folder.id})")
    
    self.loop_folder(start_folder, Args.list_skip_folders is True, Args.list_skip_files is True)

    Log.info('Completed!')

  
  def loop_folder(self, parent = ROOT_ID, skip_folders = True, skip_files = True):

    items = list_file_in_folder_recursively(parent, skip_folders = skip_folders, skip_files = skip_files)

    Log.info(f"total: {len(items)} items")
    
    for item in items:
      toPrint = []
      if item.path:
        for p in item.path:
          toPrint.append(p.filename if p.filename != 'root' else '')

      toPrint.append(item.filename)
      print( '/'.join(toPrint) )

