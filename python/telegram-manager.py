import initialize
from configuration import Config
from constants import ROOT_ID
from services.database import init_database, getItem
from services.tgclients import TGClients
from services.fsapi import FSApi
from pyrogram import idle
from aiohttp import web
import asyncio
import logging

Log = logging.getLogger("APP")

for name, logger in logging.root.manager.loggerDict.items():
  if name.startswith('pyrogram') or name.startswith('pymongo'):
    if isinstance(logger, logging.Logger):
      logger.setLevel(logging.WARNING)

async def start():
  Log.info('Starting application')

  init_database()

  for user in Config.telegram.users:
    await TGClients.add_client(user.id, user.api_id, user.api_hash, getattr(user, 'bot_token', None))
  
  TGClients.check()

  if initialize.Args.list is True:
     
    from commands.list import ListFS
    listfs = ListFS()
    await listfs.listing(initialize.Args)

  elif initialize.Args.sync is True:
    # enable sync command
    from commands.sync import Sync

    sync = Sync()
    await sync.sync_command(initialize.Args)
  
  elif initialize.Args.strm is True:
    # enable sync command
    from commands.strm import Strm

    strm = Strm()
    strm.create(initialize.Args)

  else:

    # start tool

    if Config.http.enabled:
      # start http server
      Log.info('starting http server')
      from httpserver import web_server

      server = web.AppRunner(web_server())
      await server.setup()
      await web.TCPSite(server, Config.http.host, Config.http.port).start()
    
    if Config.telegram.bot_token:
      from tgbot import Bot
      await Bot.start()


    await idle()


loop = asyncio.get_event_loop()

if __name__ == "__main__":
  Log.info('INIT')
  try:
      loop.run_until_complete(start())
  except KeyboardInterrupt:
      pass
  except Exception as err:
      logging.error(err.with_traceback(None))
  finally:
      # loop.run_until_complete(cleanup())
      loop.stop()
      logging.info("STOP")


