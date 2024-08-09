import os
import logging
from services.database import getItem, list_file_in_folder_recursively
from configuration import Config
from constants import ROOT_ID
from services.fsapi import FSApi as FSApiLib
import shutil

Log = logging.getLogger("Strm")

class Strm():

  fsapi = None
  url = ''

  def __init__(self):
    root = getItem(ROOT_ID)
    self.fsapi = FSApiLib( root )   
     

  def create(self, Args):

    recreate_folder = Args.strm_clear_folder or Config.strm.clear_folder
    local_folder = Args.strm_destination or Config.strm.destination
    source_folder = Args.strm_source or Config.strm.source
    self.url = Args.strm_url or Config.strm.url
    

    if recreate_folder and os.path.exists(local_folder):
      shutil.rmtree(local_folder)
    
    if not os.path.exists(local_folder):
      os.makedirs(local_folder)

    source = getItem(ROOT_ID)
    if source_folder:
      source = self.fsapi.get_last_folder(source_folder)
    if not source:
      raise Exception(f"invalid source folder '{source_folder}'")
    
    self.loop_folder(source.id, local_folder)

    Log.info('Completed!')
  

  def loop_folder(self, parent_id, local_folder):

    if not os.path.exists(local_folder):
      os.makedirs(local_folder)

    files = list_file_in_folder_recursively(parent_id, skip_folders = True, skip_files = False, ordered = True)

    for file in files:

      if ( file.state != 'ACTIVE'):
        continue
    
      folders = [file.filename]
      if file.path:
        for p in file.path:
          folders.append(p.filename if p.filename != 'root' else '')
      #folders.reverse()


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

