import initialize
import traceback
from configuration import Config
from constants import ROOT_ID
from services.database import init_database, save_tg_session, get_tg_session, close_connection, addEvent
from services.tgclients import TGClients
from services.fsapi import FSApi
from pyrogram import idle
from aiohttp import web
from tgbot import Bot
import asyncio
import logging

Log = logging.getLogger("APP")

for name, logger in logging.root.manager.loggerDict.items():
  if name.startswith('pyrogram') or name.startswith('pymongo') or name.startswith('aiohttp.access'):
    if isinstance(logger, logging.Logger):
      logger.setLevel(logging.WARNING)


async def init_tg_users():
  for user in Config.telegram.users:
    session = get_tg_session(user.name)
    Log.debug(f"got session from DB for user: {user.name} -> {session is not None}")
    client = await TGClients.add_client(user.name, user.api_id, user.api_hash, getattr(user, 'bot_token', None), session)
    if session is None:
      Log.info(f"save session for user {user.name}")
      tgsess = await client.get_session()
      save_tg_session( client._name, tgsess )
    Log.info(f"Telegram is authenticated for user {user.name}")

  TGClients.check()

async def start():
  Log.info('Starting application')

  init_database()

  if initialize.Args.list is True:
     
    from commands.list import ListFS
    listfs = ListFS()
    await listfs.listing(initialize.Args)

  elif initialize.Args.sync is True:
    # enable sync command
    from commands.sync import Sync

    await init_tg_users()

    sync = Sync()
    await sync.sync_command(initialize.Args)
  
  elif initialize.Args.copy is True:
    # enable sync command
    from commands.copy import Copy

    await init_tg_users()

    copy = Copy()
    await copy.copy_command(initialize.Args)
  
  elif initialize.Args.delete:
    # enable sync command
    from commands.deleting import Deleting

    await init_tg_users()

    deleting = Deleting()
    await deleting.delete_command(initialize.Args)

  else:

    # start tool

    if Config.http.enabled:
      # start http server
      Log.info('starting http server')
      from httpserver import web_server

      await init_tg_users()

      server = web.AppRunner(web_server())
      await server.setup()
      await web.TCPSite(server, Config.http.host, Config.http.port).start()

      Log.info(f"HTTP is running on {Config.http.host}:{Config.http.port}")
    
      if Config.telegram.bot_token:
        await Bot.start()
    

    if initialize.Args.strm is True:
      Log.info('Starting STRM service')
      # enable sync command
      from commands.strm import Strm

      strm = Strm()
      strm.create(initialize.Args)
    
  Log.info("Application started!")


async def close():
  Log.info('closing sessions')
  # save sessions:
  clients = TGClients.get_all_clients()
  for client in clients:
    session = await client.get_session()
    Log.debug(f"save session for user {client._name}")
    save_tg_session( client._name, session )
  
  close_connection()



import sys
async def async_except_hook(exctype, value, traceback_):
  # Log.error("--- ERROR ---")
  # Log.error(f"{exctype}, {value}")
  # Log.error( '\n'.join(traceback.format_tb(traceback_)) )
  # Log.error("--- ERROR ---")
  sys.__excepthook__(exctype, value, traceback_)
  if Config.telegram.notify is not None and Config.telegram.notify.channel is not None:
    res = await Bot.send_message(Config.telegram.notify.channel, '\n'.join(("- ERROR", f"{exctype}, {value}", "ERROR -")))
    Log.debug(f"notification sent: {res}")

def _except_hook(exctype, value, traceback_):
  loop.run_until_complete(async_except_hook(exctype, value, traceback_))
sys.excepthook = _except_hook

def exception_handler(loop, context):
  Log.error('---- ERROR ----->')
  Log.error(context['exception'])
  Log.error('<---- ERROR -----')


loop = asyncio.get_event_loop()
loop.set_exception_handler(exception_handler)

if __name__ == "__main__":
  Log.info('INIT')
  try:
      loop.run_until_complete(start())
      if Config.http.enabled:
        # keep running if http is enabled
        loop.run_forever()

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


