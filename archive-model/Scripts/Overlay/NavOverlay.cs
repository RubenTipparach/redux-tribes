using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Shapes;

//[ExecuteInEditMode]
public class NavOverlay : MonoBehaviour
{
    public CustomLineProperties mainLineProp;
    public CustomLineProperties secondaryLineProp;
    public CustomLineProperties attackLineProp;

    public ShapeSpaceUtilities drawer;

    public NavMove nav;

    public CustomLineProperties moveDisc;
    public CustomLineProperties moveDis2;

    public CustomLineProperties needMovementLine;

    public CustomLineProperties elevationLine1;
    public CustomLineProperties elevationLine2;
    public float ringThickness = 5;
    public float elevationRingThickness = 0.05f;


    [Range(8, 64)]
    public int iterations = 16;

    // Start is called before the first frame update
    void Start()
    {
        drawer.drawCmd = Drawing;


    }

    void Drawing()
    {

        if (nav != null && nav.controllingShip != null)
        {

            var direction = nav.WidgetPosition - nav.controllingShip.transform.position;
            bool isWidgetGreaterThanMax = direction.magnitude > nav.controllingShip.MaxThrusterRange;
            Vector3 maxPosition = nav.MaxShipPosition;


            // this draws a straight line.
            //Draw.Line(nav.controllingShip.transform.position, maxPosition , mainLineProp.color);

            if (isWidgetGreaterThanMax)
            {
                secondaryLineProp.DrawNormal();
                secondaryLineProp.DrawDash();
                Draw.Line(maxPosition, nav.WidgetPosition, mainLineProp.color);

            }

            if(nav.controllingShip.Targeting != null && GameManager.Instance.showShipTarget)
            {
                attackLineProp.DrawNormal();
                attackLineProp.DrawDash();

                Draw.Line(nav.controllingShip.transform.position,
                    nav.controllingShip.Targeting.transform.position,
                    attackLineProp.color);
            }

            // setup move mode.
            if(nav.controllingShip.ConfirmedMove == false)
            {
                Draw.ResetAllDrawStates();
                var maxDirection =  maxPosition - nav.controllingShip.transform.position;
                var directionHeight = Vector3.Scale(direction, new Vector3(1, 0, 1));
                var distance = directionHeight.magnitude;

                var directionHeightMax = Vector3.Scale(maxDirection, new Vector3(1, 0, 1));
                var distanceMax = Vector3.Scale(maxDirection, new Vector3(1, 0, 1)).magnitude;

                Draw.Disc(pos: nav.controllingShip.transform.position,
                    normal: Vector3.up,
                    radius: distanceMax,
                    colors: DiscColors.Radial(moveDisc.color, moveDis2.color));

              Draw.Line(maxPosition,
                    nav.controllingShip.transform.position,
                    needMovementLine.color);
                //needMovementLine.DrawNormal();
                //Draw.ResetAllDrawStates();
                var color = DiscColors.Flat(needMovementLine.color);
                Draw.Ring(pos: nav.controllingShip.transform.position,
                    normal: Vector3.up,
                    radius: distanceMax,
                    thickness: ringThickness,
                    colors: color);
                
                // Elevation 1
                Draw.Line(maxPosition,
                    directionHeightMax + nav.controllingShip.transform.position,
                    elevationLine1.color);

                Draw.Ring(pos: directionHeightMax + nav.controllingShip.transform.position,
                    normal: Vector3.up,
                    radius: 2f,
                    thickness: elevationRingThickness,
                    colors: DiscColors.Flat(elevationLine1.color));

                //this is weird and hacky, but the display doesnt like to work otherwise
                Draw.Line(nav.WidgetPosition,
                    nav.WidgetPosition,
                    elevationLine1.color);

                Draw.Ring(pos: maxPosition,
                    normal: Vector3.up,
                    radius: 2f,
                    thickness: elevationRingThickness,
                    colors: DiscColors.Flat(elevationLine1.color));

                // Elevation 2
                if (isWidgetGreaterThanMax)
                {
                    secondaryLineProp.DrawNormal();
                    secondaryLineProp.DrawDash();
                    Draw.Line(nav.WidgetPosition,
                        directionHeight + nav.controllingShip.transform.position,
                        elevationLine2.color);

                    Draw.Ring(pos: directionHeight + nav.controllingShip.transform.position,
                        normal: Vector3.up,
                        radius: 2f,
                        thickness: elevationRingThickness,
                        colors: DiscColors.Flat(elevationLine1.color));

                    Draw.Line(nav.WidgetPosition,
                        nav.WidgetPosition,
                        elevationLine2.color);

                    Draw.Ring(pos: maxPosition,
                        normal: Vector3.up,
                        radius: 2f,
                        thickness: elevationRingThickness,
                        colors: DiscColors.Flat(elevationLine1.color));

                }

                //else
                //{
                // Draw.ResetAllDrawStates();
                // secondaryLineProp.DrawDash();
                // Draw.Ring(pos: nav.controllingShip.transform.position,
                //     normal: Vector3.up,
                //     radius: distance,
                //     thickness: ringThickness,
                //     colors: DiscColors.Flat(needMovementLine.color));
                //}
            }
        }
    }


    // Update is called once per frame
    void Update()
    {

    }
}
