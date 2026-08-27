using System.Collections;
using System.Collections.Generic;
using Shapes;
using UnityEngine;

[RequireComponent(typeof(ShapeSpaceUtilities))]
public class ShipNavOverlay : MonoBehaviour
{
    public CustomLineProperties mainLineProp;
    public CustomLineProperties coneColor;
    public CustomLineProperties coneEstimatorCursorColor;

    //public CustomLineProperties secondaryLineProp;
    //public CustomLineProperties attackLineProp;

    public ShapeSpaceUtilities drawer;

    public ShipController controllingShip;

    public GameObject shipNavPreview;

    public bool shipUnitLine = true;
    //[Range(8, 64)]
    int iterations = 8;
    // Start is called before the first frame update
    void Start()
    {
        drawer.drawCmd = Drawing;
        controllingShip = GetComponent<ShipController>();

    }

    void Drawing()
    {

        if (controllingShip != null && GameManager.Instance.showShipTrajectories)
        {

            //var direction = nav.WidgetPosition - controllingShip.transform.position;
            //bool isWidgetGreaterThanMax = direction.magnitude > controllingShip.maxThrusterRange;
            //Vector3 maxPosition = nav.MaxShipPosition;

            mainLineProp.DrawNormal();
            mainLineProp.DrawDash();
            //mainLineProp.DrawNormal();

            //Debug.Log("------------------------------------");

            if (controllingShip.Targeting != null)
            {
                bool hasWeaponTarget = false;
                foreach (var w in controllingShip.weapons)
                {
                    if (w.attackInfoOrder != null)
                    {
                        hasWeaponTarget = true;
                    }
                }

                if (!hasWeaponTarget)
                {
                    var targetPosition = controllingShip.targettingSubsystem != null ?
                         controllingShip.targettingSubsystem.transform.position
                         :
                         controllingShip.Targeting.transform.position;
                    Draw.Line(transform.position, targetPosition, coneColor.color);

                }
            }

            if (controllingShip.moveable)
            {
                Vector3 lastPoint = controllingShip.transform.position;
                for (int i = 0; i < iterations + 1; i++)
                {
                    float percent = (float)i / (float)iterations;
                    var simVectorTargets = controllingShip.positionUpdate;
                    Vector3 point = Vector3.zero;
                    if (GameManager.Instance.simulationController.SimulationState == SimulationState.Planning)
                    {
                        point = simVectorTargets.GetPointOnRouteBeforeSim(
                            controllingShip.transform.position,
                            controllingShip.shipMovementEstimator.transform.position,
                            percent);
                        Draw.Line(lastPoint, point, mainLineProp.color);
                        lastPoint = point;


                    }
                    else if (percent > GameManager.Instance.simulationController.timer.GetProgress)
                    {
                        point = simVectorTargets.GetPointOnRouteDuringSim(
                            percent);
                        Draw.Line(lastPoint, point, mainLineProp.color);
                        lastPoint = point;
                    }
                    else
                    {
                        Draw.Line(lastPoint, controllingShip.transform.position, mainLineProp.color);
                    }


                    //Debug.Log(percent);
                    //Debug.Log(lastPoint);
                    //Debug.DrawLine(lastPoint, point, mainLineProp.color);
                }
                //Draw.Line(controllingShip.transform.position, controllingShip.positionUpdate.simTarget, mainLineProp.color);


                //Draw.Rotate()

                // draw the carrot
                if (controllingShip.isPlayerShip)
                {
                    // have some sort of confirmation step for players.
                    Draw.Rotation = controllingShip.rotationUpdate.simTarget;
                    Draw.Cone(Quaternion.Inverse(controllingShip.rotationUpdate.simTarget) * controllingShip.positionUpdate.simTarget, coneColor.DashSize, coneColor.DashOffset, coneColor.color);
                }
                else //assume that the enemy has chosen their next move.
                {
                    Draw.Rotation = controllingShip.shipMovementEstimator.transform.rotation;
                    Draw.Cone(Quaternion.Inverse(controllingShip.shipMovementEstimator.transform.rotation) * controllingShip.shipMovementEstimator.transform.position, coneColor.DashSize, coneColor.DashOffset, coneColor.color);
                }
                bool playerSelectedShip = controllingShip == GameManager.Instance.shipSelected
                            && controllingShip.isPlayerShip;

                if (shipNavPreview != null)
                {
                    DrawShipNav(playerSelectedShip);
                }
            }

        }

        if(shipUnitLine)
        {
            
        }
    }

    private void DrawShipNav(bool playerSelectedShip)
    {
        // duplicate ship ghosting thing to illustrate where the ship is in timeline!
            if (GameManager.Instance.simulationController.SimulationState == SimulationState.Planning
                && GameManager.Instance.selectedTime > 0.5f
                && (!playerSelectedShip || (playerSelectedShip && (GameManager.Instance.selectedTime < 9.5f)))
                )
            {
                if (!shipNavPreview.activeInHierarchy)
                {
                    shipNavPreview.SetActive(true);
                }
                var cursorTimeline = GameManager.Instance.selectedTime / 10f;
                var estimatedCursorRotation = Quaternion.Lerp(controllingShip.transform.rotation, controllingShip.shipMovementEstimator.transform.rotation, cursorTimeline);
                var estimatedCursorPosition = controllingShip.positionUpdate.GetPointOnRouteBeforeSim(
                        controllingShip.transform.position,
                        controllingShip.shipMovementEstimator.transform.position,
                        cursorTimeline);
                //Draw.Rotation = estimatedCursorRotation;
                //DrawCube(estimatedCursorRotation, estimatedCursorPosition, new Vector3(1, 1, .5f), Vector3.zero);
                //DrawCube(estimatedCursorRotation, estimatedCursorPosition, new Vector3(1, .5f, .5f), Vector3.forward * .5f + Vector3.up * -.5f);

                //Draw.Cube(estimatedCursorPosition, coneEstimatorCursorColor.DashSize, coneEstimatorCursorColor.color);
                shipNavPreview.transform.rotation = estimatedCursorRotation;
                shipNavPreview.transform.position = estimatedCursorPosition;
            }
            else
            {
                if (shipNavPreview.activeInHierarchy)
                {
                    shipNavPreview.SetActive(false);
                }
            }

    }
    private void DrawCube(Quaternion rotation, Vector3 position, Vector3 size, Vector3 offset)
    {

        // Draw.Cuboid(Quaternion.Inverse(estimatedCursorRotation) * (estimatedCursorPosition),
        // coneEstimatorCursorColor.DashOffset * (new Vector3(1, 1, .5f)),
        // coneEstimatorCursorColor.color);
        Draw.Cuboid(Quaternion.Inverse(rotation) * (position),
                   coneEstimatorCursorColor.DashOffset * (size),
                   coneEstimatorCursorColor.color);
    }
}
