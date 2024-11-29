import os
import logging
from services.database import getItem, list_file_in_folder_recursively, addEvent
from configuration import Config
from constants import ROOT_ID
from services.fsapi import FSApi as FSApiLib
import shutil

Log = logging.getLogger("Strm")

class Strm():

  fsapi = None
  url = ''
  source = None
  local_folder = None

  def __init__(self):
    root = getItem(ROOT_ID)
    self.fsapi = FSApiLib( root )   
     

  def create(self, Args):

    recreate_folder = Args.strm_clear_folder or Config.strm.clear_folder
    local_folder = Args.strm_destination or Config.strm.destination
    source_folder = Args.strm_source or Config.strm.source
    self.url = Args.strm_url or Config.strm.url

    Log.debug(f"using flags: {recreate_folder}, {source_folder}, {self.url}")

    Log.info(f"Using folder: {local_folder}")

    if recreate_folder and os.path.exists(local_folder):
      Log.info(f"deleting existing folder {local_folder}")
      shutil.rmtree(local_folder)
    
    if not os.path.exists(local_folder):
      Log.info(f"creating folder {local_folder}")
      os.makedirs(local_folder)

    source = getItem(ROOT_ID)
    if source_folder:
      Log.info(f"get source folder {source_folder}")
      source = self.fsapi.get_last_folder(source_folder)
    if not source:
      raise Exception(f"invalid source folder '{source_folder}'")
  
    self.source = source
    self.local_folder = local_folder
    
    self.loop_folder(source.id, local_folder)

    Log.info('Completed!')

    addEvent(self.watch_changes)
  

  def loop_folder(self, parent_id, local_folder):

    if not os.path.exists(local_folder):
      os.makedirs(local_folder)
    
    Log.info("Listing all files")

    files = list_file_in_folder_recursively(parent_id, skip_folders = True, skip_files = False, ordered = True)

    Log.info(f"populating {len(files)} files")

    for file in files:

      if ( file.state != 'ACTIVE'):
        continue
    
      folders = []
      if file.path:
        for p in file.path:
          folders.append(p.filename if p.filename != 'root' else '')
      
      folders.append(file.filename)


      self.createFile(file, local_folder, '/'.join(folders) )
  

  def createFile(self, file, local_folder, filepath):

    if filepath.startswith('/'):
      # remove first slash
      filepath = filepath[1:]

    destination_full_path = os.path.join(local_folder, filepath)
    
    dir_path = os.path.dirname(destination_full_path)

    if not os.path.exists(dir_path):
      os.makedirs(dir_path)

    if ( file.content is not None and file.content_length() > 0 ):

      f = open( destination_full_path, "wb")
      f.write( file.content )
      f.close()

    else:
      strm_txt = self.url.replace('{file_id}', file.id)
      f = open( f"{destination_full_path}.strm", "w")
      f.write( strm_txt )
      f.close()


  def watch_changes(self, type, doc, id):
    if type != 'insert':
      return False
    
    # new document has been created
    Log.info(f"a new document detected: {doc.type} -> {doc.filename}")

    relative_path = FSApiLib.build_path(doc)

    destination_full_path = os.path.join(self.local_folder, relative_path)

    dir_path = os.path.dirname(destination_full_path)

    Log.info(f"it will be stored as: {destination_full_path}")

    if not os.path.exists(dir_path):
      os.makedirs(dir_path)

    if doc.type == 'folder':
      # new folder created
      if not os.path.exists(destination_full_path):
        Log.info(f"creating folder: {destination_full_path}")
        os.makedirs(destination_full_path)
    else:
      # new file created
      Log.info(f"creating file: {destination_full_path}")
      self.createFile(doc, self.local_folder, relative_path)
    