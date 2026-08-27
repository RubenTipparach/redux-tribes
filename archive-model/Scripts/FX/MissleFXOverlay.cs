using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Shapes;

[RequireComponent(typeof(ShapeSpaceUtilities))]
[RequireComponent(typeof(MissileFX))]
public class MissileFXOverlay : MonoBehaviour
{
    public CustomLineProperties mainLineProp;
    // public CustomLineProperties coneColor;
    // public CustomLineProperties coneEstimatorCursorColor;

    //public CustomLineProperties secondaryLineProp;
    //public CustomLineProperties attackLineProp;

    public ShapeSpaceUtilities drawer;

    public MissileFX missile;

    public GameObject shipNavPreview;

    public bool shipUnitLine = true;
    //[Range(8, 64)]
    int iterations = 8;

    public bool showTrajectories = false;

    void Start()
    {
        drawer.drawCmd = Drawing;
        missile = GetComponent<MissileFX>();
    }
    void Drawing()
    {

        if (missile != null && GameManager.Instance.showShipTrajectories && showTrajectories)
        {

            //var direction = nav.WidgetPosition - controllingShip.transform.position;
            //bool isWidgetGreaterThanMax = direction.magnitude > controllingShip.maxThrusterRange;
            //Vector3 maxPosition = nav.MaxShipPosition;

            mainLineProp.DrawNormal();
            mainLineProp.DrawDash();
            //mainLineProp.DrawNormal();

            //Debug.Log("------------------------------------");

            Vector3 lastPoint = missile.transform.position;
            for (int i = 0; i < iterations + 1; i++)
            {
                float percent = (float)i / (float)iterations;
                var simVectorTargets = missile.movementDescriptor;
                Vector3 point = Vector3.zero;
                if (GameManager.Instance.simulationController.SimulationState == SimulationState.Planning)
                {
                    point = simVectorTargets.GetPointOnRouteBeforeSim(
                        missile.transform.position,
                        missile.movementEstimator.transform.position,
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
                    Draw.Line(lastPoint, missile.transform.position, mainLineProp.color);
                }


                //Debug.Log(percent);
                //Debug.Log(lastPoint);
                //Debug.DrawLine(lastPoint, point, mainLineProp.color);
            }
            //Draw.Line(controllingShip.transform.position, controllingShip.positionUpdate.simTarget, mainLineProp.color);
        }
    }

}