import initialize
import traceback
from configuration import Config
from constants import ROOT_ID
from services.database import init_database, save_tg_session, get_tg_session, getItem
from services.tgclients import TGClients
from services.fsapi import FSApi
from pyrogram import idle
from aiohttp import web
import asyncio
import logging

Log = logging.getLogger("APP")

for name, logger in logging.root.manager.loggerDict.items():
  if name.startswith('pyrogram') or name.startswith('pymongo') or name.startswith('aiohttp.access'):
    if isinstance(logger, logging.Logger):
      logger.setLevel(logging.WARNING)

async def start():
  Log.info('Starting application')

  init_database()

  for user in Config.telegram.users:
    session = get_tg_session(user.id)
    Log.debug(f"got session from DB for user: {user.id} -> {session is not None}")
    client = await TGClients.add_client(user.id, user.api_id, user.api_hash, getattr(user, 'bot_token', None), session)
    if session is None:
      Log.info(f"save session for user {user.id}")
      tgsess = await client.get_session()
      save_tg_session( client._name, tgsess )
    Log.info(f"Telegram is authenticated for user {user.id}")

  
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

      Log.info(f"HTTP is running on {Config.http.host}:{Config.http.port}")
    
    if Config.telegram.bot_token:
      from tgbot import Bot
      await Bot.start()
    

    # root = getItem(ROOT_ID)
    # fsapi = FSApi(root)
    # await fsapi.copy('/media/tvshows/Chicago P.D. (2014)', '/media/tvprograms')


    await idle()


async def close():
  Log.info('closing sessions')
  # save sessions:
  clients = TGClients.get_all_clients()
  for client in clients:
    session = await client.get_session()
    Log.debug(f"save session for user {client._name}")
    save_tg_session( client._name, session )


loop = asyncio.get_event_loop()

if __name__ == "__main__":
  Log.info('INIT')
  try:
      loop.run_until_complete(start())
  except KeyboardInterrupt:
      pass
  except Exception as err:
      traceback.print_exc()
      logging.error(err, exc_info=True)
  finally:
      # loop.run_until_complete(cleanup())
      loop.stop()

      loop.run_until_complete(close())

      logging.info("STOP")


