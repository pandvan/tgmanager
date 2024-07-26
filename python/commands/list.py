import logging
from services.database import getItem, getChildren
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
    else:
      folder = await self.fsapi.get_last_folder(start_folder)
      if folder is None:
        raise Exception(f"folder '{start_folder}' not found")
      start_folder = folder.id
    self.loop_folder(start_folder, Args.list_show_folders is not False, Args.list_show_files is not False)

    Log.info('Completed!')

  
  def loop_folder(self, parent = ROOT_ID, show_folders = True, show_files = True):

    items = getChildren(parent, ordered = True)

    for item in items:
      if item.type == 'folder' and show_folders:
        print( FSApiLib.build_path(item) )
      if item.type != 'folder' and show_files:
        print( FSApiLib.build_path(item) )
      if item.type == 'folder':
        self.loop_folder(item.id, show_folders, show_files)
