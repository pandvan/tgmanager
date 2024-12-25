FROM python:3.10.16-alpine

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

RUN python3 -m venv $VIRTUAL_ENV

COPY python app/

WORKDIR app

RUN apk add openssl-dev openssl \
    && pip install wheel \
    && pip install -r requirements.txt

CMD ["python", "./telegram-manager.py"]
