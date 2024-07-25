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
     

  def listing(self, parent = ROOT_ID):

    items = getChildren(parent)

    for item in items:
      print( FSApiLib.build_path(item) )
      if item.type == 'folder':
        self.listing(item.id)
