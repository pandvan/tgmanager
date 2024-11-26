import logging
from configuration import Config
from aiohttp import web
import os
from .routes import routes
from aiohttp_basicauth import BasicAuthMiddleware
from constants import CWD


logger = logging.getLogger("WEB")

class CustomBasicAuth(BasicAuthMiddleware):
  async def check_credentials(self, username, password, request):
    logger.debug(f"request from: {str(request.remote)}")
    if str(request.remote).startswith("172.18"):
      # here, for example, you can search user in the database by passed `username` and `password`, etc.
      logger.info(f"request from {str(request.remote)}, do not check AUTH")
      return True
    return username == Config.http.user and password == Config.http.password

def web_server():
  logger.debug("Initializing..")
  if Config.http.user and Config.http.password:
    # auth = BasicAuthMiddleware(username = Config.http.user, password = Config.http.password)
    auth = CustomBasicAuth()
    web_app = web.Application(middlewares=[auth], client_max_size=100 * 1024 * 1024 * 1024)
  else:
    web_app = web.Application(client_max_size=100 * 1024 * 1024 * 1024)
  web_app.add_routes(routes)
  web_app.router.add_static('/public/', path= os.path.join(CWD, './public/'), name='static')
  return web_app