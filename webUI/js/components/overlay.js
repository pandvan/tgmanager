import React, { useCallback, useEffect, useState } from 'react';
import { Accordion, Button, Col, Modal, Row } from 'react-bootstrap';
import * as Utils from '../utils';
import { DragDropContext, Draggable, Droppable } from "react-beautiful-dnd";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGripLines } from '@fortawesome/free-solid-svg-icons';


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


export function OverlayMerge(props) {

  const {items, onClose} = props;
  const [isShown, setShown] = useState(true);

  const [itemsToMerge, setItemsToMerge] = useState(items);


  const dragEnded = useCallback((param) =>{
    const { source, destination } = param;
    let _arr = [...itemsToMerge];
    //extracting the source item from the list
    const _item = _arr.splice(source.index, 1)[0];
    //inserting it at the destination index.
    _arr.splice(destination.index, 0, _item);
    setItemsToMerge(_arr);
  }, [itemsToMerge]);

  const onMerge = useCallback(async () => {
    let error = false;
    try {
      await Utils.mergeFiles(itemsToMerge);
    } catch(e) {
      error = true;      
    }
    _onClose(error, true);
  }, [itemsToMerge]);

  const _onClose = useCallback((err, operationConfirmed) => {
    setShown(false);
    if ( onClose) {
      onClose(err, operationConfirmed);
    }
  }, []);

  return (
    <Overlay isShown={isShown} stopClose={true} title="Merge items" onClose={_onClose} onConfirm={onMerge} >
      <h6>You are <span className="fst-italic">merging</span> selected files</h6>

      <DragDropContext onDragEnd={dragEnded}>
        <Droppable droppableId="items-wrapper">
        {(provided, snapshot) => (
          <ul ref={provided.innerRef} {...provided.droppableProps} className="list-group">
            {itemsToMerge.map((item, index) => {
              return (
                <Draggable
                  draggableId={`item-${item.id}`}
                  index={index}
                  key={item.id}>
                  {(_provided, _snapshot) => (
                    <li ref={_provided.innerRef} {..._provided.dragHandleProps} {..._provided.draggableProps} snapshot={_snapshot} className="list-group-item border my-2">
                      <Row className="py-2 px-1">
                        <Col xs="1"><FontAwesomeIcon icon={faGripLines} /></Col>
                        <Col xm="11">{item.filename}</Col>
                      </Row>
                    </li>
                  )}
                </Draggable>
              )
            })}
          </ul>
        )}
        </Droppable>
      </DragDropContext>
    </Overlay>
  )



}