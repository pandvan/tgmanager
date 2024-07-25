import os
import logging
from services.database import getItem, getChildren
from constants import ROOT_ID
from services.fsapi import FSApi as FSApiLib
import shutil

Log = logging.getLogger("List")

class Strm():

  fsapi = None
  url = ''

  def __init__(self):
    root = getItem(ROOT_ID)
    self.fsapi = FSApiLib( root )   
     

  def create(self, Args):

    recreate_folder = Args.strm_re_create_folder
    local_folder = Args.strm_folder
    self.url = Args.strm_url
    

    if os.path.exists(local_folder):
      if recreate_folder:
        shutil.rmtree(local_folder)
    
    if not os.path.exists(local_folder):
      os.makedirs(local_folder)


    self.loop_folder(ROOT_ID, local_folder)
  

  def loop_folder(self, parent_id, local_folder):

    if not os.path.exists(local_folder):
      os.makedirs(local_folder)

    children = getChildren(parent_id)

    for child in children:

      if ( child.state != 'ACTIVE'):
        continue

      if ( child.type == 'folder' ):

        folderChild = os.path.join( local_folder, child.filename)

        self.loop_folder(child.id, folderChild )
      
      else:

        self.createFile(child, local_folder)
  

  def createFile(self, file, folderPath):
    if ( file.content is not None and file.content_length() > 0 ):

      f = open( os.path.join(folderPath, file.filename), "wb")
      f.write( file.content)
      f.close()

    else:
      strm_txt = self.url.replace('{file_id}', file.id)
      f = open( f"{os.path.join(folderPath, file.filename)}.strm", "w")
      f.write( strm_txt )
      f.close()

