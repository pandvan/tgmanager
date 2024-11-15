import os
import traceback
import logging
from services.database import getItem, TGFolder
from constants import ROOT_ID
from services.fsapi import FSApi as FSApiLib

Log = logging.getLogger('SYNC')

class Deleting():

  fsapi = None

  def __init__(self):
    root = getItem(ROOT_ID)
    self.fsapi = FSApiLib( root )


  async def delete_command(self, Args):
    
    if not Args.delete:
      raise Exception("You must specify element to delete")

    dry_run = Args.delete_dry_run is True

    exists = self.fsapi.exists(Args.delete, state = 'ACTIVE')

    if exists:
      await self.fsapi.delete( Args.delete, simulate= dry_run )



    Log.info('Completed!')




