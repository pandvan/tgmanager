FROM node:22-alpine as webui

COPY . /app

WORKDIR app

RUN npm ci \
    && npm run build


FROM python:3.10.16-alpine

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

RUN python3 -m venv $VIRTUAL_ENV

COPY python app/
COPY --from=webui /app/python/public app/public

WORKDIR app

RUN apk add openssl-dev libgcc \
    && pip install wheel \
    && pip install https://github.com/alpine-wheels/cryptg/releases/download/0.5.0.post0/cryptg-0.5.0.post0-cp310-cp310-linux_x86_64.whl \
    && pip install -r requirements.txt \
    && sed -i -e "s/ctypes\.util\.find_library('ssl')/'libssl.so'/g" $VIRTUAL_ENV/lib/python$(echo $PYTHON_VERSION | cut -d'.' -f1,2)/site-packages/telethon/crypto/libssl.py

CMD ["python", "./telegram-manager.py"]
