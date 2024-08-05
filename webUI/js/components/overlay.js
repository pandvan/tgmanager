import React, { useCallback, useState } from 'react';
import { Accordion, Button, Modal } from 'react-bootstrap';
import * as Utils from '../utils';


export function Overlay(props) {

  const {
    isShown,
    title,
    onConfirm,
    onClose,
    stopClose,
    children
  } = props;

  return (
    <Modal
      show={isShown}
      backdrop={stopClose ? "static" : true}
      onHide={onClose}
      keyboard={false}
    >
      <Modal.Header>
        <Modal.Title>{title || ''}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {children}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} >
          Close
        </Button>
        <Button variant="primary" onClick={onConfirm}>Ok</Button>
      </Modal.Footer>
    </Modal>
  )
}


export function OverlayDelete(props) {

  const {items, onClose} = props;
  const [isShown, setShown] = useState(true);

  const deleteItems = useCallback(async () => {
    let error = false;
    for ( const item of items ) {
      try {
        if ( item.type == 'folder' ) {
          await Utils.deleteFolder(item.id);
        } else {
          await Utils.deleteFile(item.id);
        }
      } catch(e) {
        error = true
        const resp = confirm(`Error while deleting '${item.filename}'.\nContinue?`);
        if (!resp) {
          break;
        }
      }
    }
    _onClose(error, true);
  }, [items, _onClose]);

  const _onClose = useCallback((err, operationConfirmed) => {
    setShown(false);
    if ( onClose) {
      onClose(err, operationConfirmed);
    }
  }, []);

  return (
    <Overlay isShown={isShown} onConfirm={deleteItems} stopClose={true} title="Delete items" onClose={_onClose} >
      <Accordion>
        <Accordion.Item eventKey="0">
          <Accordion.Header>Are you sure you want delete {items.length} items?</Accordion.Header>
          <Accordion.Body style={{'maxHeight': 200, 'overflow': 'auto'}}>
            <ul>
              {items.map( i => {
                return <li key={i.id}>{i.filename}</li>
              })}
            </ul>
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    </Overlay>
  )



}


