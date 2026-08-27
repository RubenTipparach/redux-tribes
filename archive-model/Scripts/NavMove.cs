using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;

public class NavMove : MonoBehaviour
{

    public bool isDragging = false;
    private Plane dragPlane;
    private Plane verticalDragPlane;
    public bool isDraggingVertical = false;
    public bool isRolling = false;
    Vector3 hitPointV;
    //Vector3 maxMovePosition;
    public float rollSensititivity = 1;

    private bool isRotating = false;
    public Vector3 elevationHitPoint;
    
    //public const string Layer_Selected = "Outline_1";
    public const string Layer_Hover = "Outline_Hover";
    int navLayer => LayerMask.NameToLayer("Nav");

    public GameObject selectedObject;

    //public Raycas
    public Vector3 WidgetPosition
    {
        get
        {
            return transform.position;
        }
    }

    public ShipController controllingShip;

    public GameObject elevationUp;
    public GameObject elevationDown;

    public void ShowWidget(bool show)
    {
        elevationUp.SetActive(show);
        elevationDown.SetActive(show);
    }

    public Vector3 MaxShipPosition
    {
        get
        {
            var direction = WidgetPosition - controllingShip.transform.position;
            bool isWidgetGreaterThanMax = direction.magnitude > controllingShip.MaxThrusterRange;
            return isWidgetGreaterThanMax ?
               direction.normalized * controllingShip.MaxThrusterRange + controllingShip.transform.position
               :
               WidgetPosition;

        }
    }

    private void Update()
    {
        bool uiRaycastBlock = EventSystem.current.IsPointerOverGameObject();

        if (controllingShip == null
            
            || GameManager.Instance.simulationController.SimulationState != SimulationState.Planning
            || !controllingShip.isPlayerShip
            || controllingShip.ConfirmedMove)
        {
            return;
        }

        if (Input.GetMouseButtonDown(0) && !uiRaycastBlock)
        {
            PlaneManuevering();
        }
        // vertical management
        else if (Input.GetMouseButton(0) && isDragging)
        {
            VerticalManuever();
        }
        else if (Input.GetMouseButtonUp(0) && isDragging)
        {
            isDragging = false;
            isDraggingVertical= false;
            verticalDragPlane = new Plane();
            isRolling = false;
            isRotating = false;
        }

        OverlayNav();
        //GameManager.Instance.EndTurn();
    }

    private void OverlayNav()
    {
        RaycastHit hoverHit;
        Ray hoverRay = Camera.main.ScreenPointToRay(Input.mousePosition);

        if (Physics.Raycast(hoverRay, out hoverHit) &&
            (hoverHit.collider.gameObject.CompareTag("ElevationArrows")
            || hoverHit.collider.gameObject.CompareTag("NavRotation")
            || hoverHit.collider.gameObject.CompareTag("RollArrow"))
            )
        {
            
            if (hoverHit.collider != null
                && selectedObject != hoverHit.collider.gameObject)
            {
                if (selectedObject != null && selectedObject == hoverHit.collider.gameObject)
                {

                }
                else
                {
                    // do stuff
                    // Debug.Log("hover over object: " + hoverHit.collider.gameObject.name);
                    if (selectedObject != null)
                    {
                        selectedObject.layer = navLayer;
                    }
                    HandleLayerSwap(hoverHit.collider.gameObject, Layer_Hover); // TODO: recursively set layer
                    selectedObject = hoverHit.collider.gameObject;
                    //sgm.campaignMenu.SetObjectSelection(selectedObject);

                }
            }
        }
        else
        {
            if (selectedObject != null && !Input.GetMouseButton(0))
            {
                selectedObject.layer = navLayer;
                selectedObject = null;
                //CampaignV2.CampaignMap.Instance.campaignMenu.SetObjectSelection(null);
            }
        }
    }

    void HandleLayerSwap(GameObject clickedObject, string layer)
    {
        clickedObject.layer = LayerMask.NameToLayer(layer);
    }


    private void PlaneManuevering()
    {
        Ray ray = Camera.main.ScreenPointToRay(Input.mousePosition);
        RaycastHit hit;

        var rayHit = Physics.Raycast(ray, out hit);
        // Check if we hit an elevation arrow
        if (rayHit && hit.collider.gameObject.CompareTag("ElevationArrows") &&
         (controllingShip.shipMoveModes == ShipMoveModes.MOVE_AND_TURN || controllingShip.shipMoveModes == ShipMoveModes.TURN_SLIDE))
        {
            var camOffset = Vector3.Scale(hit.collider.transform.position - Camera.main.transform.position, new Vector3(1, 0, 1));
            verticalDragPlane = new Plane(camOffset, hit.collider.transform.position);
            isDragging = true;
            isDraggingVertical = true;

            elevationHitPoint = transform.position - hit.point;
        }
        else if (rayHit && hit.collider.gameObject.CompareTag("NavRotation") &&
        (controllingShip.shipMoveModes == ShipMoveModes.MOVE_AND_TURN || controllingShip.shipMoveModes == ShipMoveModes.TURN_SLIDE))
        {
            isDragging = true;
            isRotating = true;
        }
        else if (rayHit && hit.collider.gameObject.CompareTag("RollArrow"))
        {
            isDragging = true;
            isRolling = true;
        }
        else if (
            (!rayHit || (
            rayHit && hit.collider.gameObject.CompareTag("Untagged")
            ))
            && (controllingShip.shipMoveModes == ShipMoveModes.MOVE_AND_TURN || controllingShip.shipMoveModes == ShipMoveModes.TURN_SLIDE)
            )// hit.collider.gameObject.CompareTag("NavWidget"))
        {
            // Define the plane based on the object's Y position
            dragPlane = new Plane(Vector3.up, new Vector3(0, transform.position.y, 0));

            // Check if our ray intersects the plane
            float enter;
            if (dragPlane.Raycast(ray, out enter))
            {
                // Set the object's position to the intersection point but maintain the object's Y value
                Vector3 hitPoint = ray.GetPoint(enter);
                transform.position = new Vector3(hitPoint.x, transform.position.y, hitPoint.z);
                isDragging = true;

                controllingShip.SetEstPosition(MaxShipPosition);
                RotateManuever();
            }
        }
    }

    private void RotateManuever()
    {
        //var ctrlDown = Input.GetKeyDown(KeyCode.LeftControl);
        var ctrlPressed = Input.GetKey(KeyCode.LeftControl);
        //if (ctrlPressed)
        if(controllingShip.shipMoveModes == ShipMoveModes.MOVE_AND_TURN)
        {
            var normal = transform.position - controllingShip.transform.position;
            var rotation = Quaternion.LookRotation(normal.normalized) * Quaternion.Euler(0,0, controllingShip.zRoll);
            controllingShip.SetEstOrientation(rotation);
        }
    }

    private void VerticalManuever()
    {
        Ray ray = Camera.main.ScreenPointToRay(Input.mousePosition);

        if (isDraggingVertical)
        {
            float enter;
            if (verticalDragPlane.Raycast(ray, out enter))
            {
                Vector3 hitPoint = ray.GetPoint(enter);
                transform.position = new Vector3(transform.position.x, hitPoint.y + elevationHitPoint.y, transform.position.z);
                //Debug.DrawLine(hitPointV, hitPointV + Vector3.up, Color.red, 5f);
                hitPointV = hitPoint;

                controllingShip.SetEstPosition(MaxShipPosition);
                RotateManuever();
            }
            else
            {
                Debug.Log("no hit");
            }
        }else if(isRolling){
            // Rotate the object based on mouse movement along the X-axis
            float rollAmount = GameManager.GameInput.MouseDelta.y;
            //Debug.Log(rollAmount.ToString("0.00"));
            //var currentRotation = controllingShip.shipMovementEstimator.transform.rotation;
            //var roll =  Quaternion.Euler(currentRotation.eulerAngles.x, currentRotation.eulerAngles.y, currentRotation.eulerAngles.z + rollAmount * rollSensititivity);
            controllingShip.shipMovementEstimator.transform.Rotate(Vector3.forward, rollAmount * rollSensititivity);
            controllingShip.CommitRotation();
            //transform.Rotate(Vector3.forward, rollAmount); // You can multiply rollAmount by a factor if you want to increase or decrease the sensitivity
        } else if (isRotating)
        {
            // if (Input.GetKey(KeyCode.LeftShift))
            // {
            isRotating = true;
            float rotationY = -Input.GetAxis("Mouse X");
            float rotationX = Input.GetAxis("Mouse Y");
            var shipHoloTransform = controllingShip.shipMovementEstimator.transform;
            var upVector = shipHoloTransform.rotation.eulerAngles.z;

            shipHoloTransform.Rotate(Vector3.up, rotationY, Space.Self);
            shipHoloTransform.Rotate(Vector3.right, rotationX, Space.Self);

            // Apply the initial roll value after every rotation operation
            // Vector3 currentEuler = shipHoloTransform.eulerAngles;
            // shipHoloTransform.eulerAngles = new Vector3(currentEuler.x, currentEuler.y, upVector);
            controllingShip.CommitRotation();

            // }
        }
        else
        {
            float enter;
            if (dragPlane.Raycast(ray, out enter))
            {
                Vector3 hitPoint = ray.GetPoint(enter);
                transform.position = new Vector3(hitPoint.x, transform.position.y, hitPoint.z);
                controllingShip.SetEstPosition(MaxShipPosition);
                RotateManuever();
            }
        }
    }

    // this perserves the up vector.
    public void SetRotation(Vector3 direction)
    {
        controllingShip.shipMovementEstimator.transform.rotation = Quaternion.LookRotation(direction, controllingShip.shipMovementEstimator.transform.up);
        controllingShip.CommitRotation();
    }

    public void SetNewTurn(ShipController ship)
    {
        transform.position = ship.shipMovementEstimator.transform.position;
    }

    internal void ActivateController(bool active)
    {
        throw new NotImplementedException();
    }
}
