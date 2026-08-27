using System;
using System.Collections;
using System.Collections.Generic;
using Shapes;
using UnityEngine;

public class WeaponOverlay : BaseOverlay
{
    public WeaponController weaponSystem;

    public bool useDashes = true;

    public float dashOffset = 2f;

    public bool drawFiringArc = false;

    public Color readyFire;

    public Vector3 eulerTweak;

    public bool debug = false;

    public WeaponSystemColorConfigs configs;

    public float arcLen = 10;

    protected override void OnEnable()
    {

        
        base.OnEnable();
    }


    protected override void DrawLine()
    {
        if (weaponSystem.ship != null && weaponSystem.ship.Targeting != null && GameManager.Instance.showWeaponTarget
            // ship is currently selected
            && GameManager.Instance.shipSelected != null && weaponSystem.ship == GameManager.Instance.shipSelected)
        {
            Draw.LineGeometry = configs.targettingLine.lineGeometry;
            Draw.ThicknessSpace = configs.targettingLine.thicknessSpace;
            Draw.Thickness = configs.targettingLine.thickness; // 4px wide
            Draw.UseDashes = useDashes;
            Draw.DashOffset = dashOffset;
            var cursorTimeline = GameManager.Instance.selectedTime / 10f;


            // Draw attack line!
            var target = weaponSystem.ship.targettingSubsystem != null ? weaponSystem.ship.targettingSubsystem.targetLocation : weaponSystem.ship.Targeting.transform;
            if (GameManager.Instance.simulationController.SimulationState == SimulationState.Planning
                && (
                    (weaponSystem.attackInfoOrder != null && weaponSystem.attackInfoOrder.IsSet)
                    || 
                    weaponSystem.mouseOver)
            )
            {
                // needs some rotational corrections, inverse the offset rotation to get its initial postional offset before any rotations
                var targetOffset = Quaternion.Inverse(weaponSystem.ship.Targeting.transform.rotation) * (target.position - weaponSystem.ship.Targeting.transform.position);

                var estimatedTargetRotation = Quaternion.Lerp(weaponSystem.ship.Targeting.transform.rotation,
                        weaponSystem.ship.Targeting.shipMovementEstimator.transform.rotation, cursorTimeline); //weapon firing predicition does need data to proced with this.

                var estimatedTargetPosition = weaponSystem.ship.Targeting.positionUpdate.GetPointOnRouteBeforeSim(
                        weaponSystem.ship.Targeting.transform.position,
                        weaponSystem.ship.Targeting.shipMovementEstimator.transform.position,
                        cursorTimeline);

                var targetPosition = estimatedTargetPosition + estimatedTargetRotation * targetOffset;

                var ship = weaponSystem.ship;
                // needs some rotational corrections,
                // inverse the offset rotation to get its initial postional offset before any rotations
                var cannonOffset = Quaternion.Inverse(ship.transform.rotation) * (weaponSystem.cannonCenterPivot.position - ship.transform.position);
                var cannonRotationOffset = Quaternion.Inverse(ship.transform.rotation) * weaponSystem.cannonCenterPivot.rotation;

                var estimatedCursorRotation = Quaternion.Lerp(ship.transform.rotation,
                    ship.shipMovementEstimator.transform.rotation, cursorTimeline);
                var estimatedCursorPosition = ship.positionUpdate.GetPointOnRouteBeforeSim(
                        ship.transform.position,
                        ship.shipMovementEstimator.transform.position,
                        cursorTimeline);

                var estimatedCannonPosition = estimatedCursorPosition + estimatedCursorRotation * cannonOffset;
                var estimatedCannonRotation = estimatedCursorRotation * cannonRotationOffset;
                bool firingArcTest = weaponSystem.CheckIfWeaponCanFire(
                    estimatedCannonPosition,
                    estimatedCannonRotation,
                    targetPosition);


                // Draw.Line(estimatedCannonPosition,
                //     estimatedCannonPosition + cannonOffset,
                //     configs.targettingLine.color);

                // Debug.DrawLine(estimatedCursorPosition,  estimatedCursorPosition + estimatedCursorRotation * cannonOffset, Color.red);
                // Line will need to support time stepping.
                Draw.Line(estimatedCannonPosition,
                    targetPosition,
                    firingArcTest ? readyFire : configs.targettingLine.color);

                if (weaponSystem.attackInfoOrder.secondSlot == (int)GameManager.Instance.selectedTime)
                {
                    DrawFiringArc(estimatedCannonPosition, estimatedCannonRotation);
                }
            }
            else
            {
                // bool firingArcTest = weaponSystem.CheckIfWeaponCanFire(weaponSystem.cannonCenterPivot.position,
                // weaponSystem.cannonCenterPivot.rotation,
                // target.position);

                // Draw.Line(weaponSystem.cannonCenterPivot.position,
                //     target.position,
                //     firingArcTest ? readyFire : configs.targettingLine.color);
            }
        }

        if (drawFiringArc
                // || 
                // (weaponSystem.attackInfoOrder != null 
                // && weaponSystem.attackInfoOrder.IsSet 
                // && weaponSystem.attackInfoOrder.secondSlot == (int)GameManager.Instance.selectedTime 
                // && GameManager.Instance.simulationController.SimulationState == SimulationState.Planning)
                )
        {
            //Draw.LineGeometry = arcLineProps.lineGeometry;
            //Draw.ThicknessSpace = arcLineProps.thicknessSpace;
            //Draw.Thickness = arcLineProps.thickness; // 4px wide
            //Draw.UseDashes = false;
            //Draw.DashOffset = dashOffset;

            // set static parameter to draw in the local space of this object
            //Draw.Matrix = transform.localToWorldMatrix;

            //Draw.Disc(transform.position + transform.up * 0.427f, transform.up, 1,
            //    //weaponSystem.firingArcSettings.minHorizontalRotationAngle,
            //    //weaponSystem.firingArcSettings.maxHorizontalRotationAngle,
            //    discColors.CreateColors());
            DrawFiringArc(weaponSystem.cannonCenterPivot.position, transform.rotation);
        }
    }

    void DrawFiringArc(Vector3 weaponPositionEst, Quaternion wepRotation){
            Draw.Pie(weaponPositionEst, wepRotation * Quaternion.Euler(90, -90, 0), arcLen,
                weaponSystem.firingArcSettings.minHorizontalRotationAngle * Mathf.Deg2Rad,
                weaponSystem.firingArcSettings.maxHorizontalRotationAngle * Mathf.Deg2Rad,
                configs.discColorsHorizontal.CreateColors());

            Draw.Arc(weaponPositionEst,  wepRotation * Quaternion.Euler(90, -90, 0), arcLen,
                weaponSystem.firingArcSettings.minHorizontalRotationAngle * Mathf.Deg2Rad,
                weaponSystem.firingArcSettings.maxHorizontalRotationAngle * Mathf.Deg2Rad,
                configs.discColorsHorizontalPie.CreateColors());


            Draw.Pie(weaponPositionEst, wepRotation * Quaternion.Euler(eulerTweak.x, eulerTweak.y, eulerTweak.z), arcLen,
                weaponSystem.firingArcSettings.minVerticalRotationAngle * Mathf.Deg2Rad,
                weaponSystem.firingArcSettings.maxVerticalRotationAngle * Mathf.Deg2Rad,
                configs.discColorsVertical.CreateColors());
             
            Draw.Arc(weaponPositionEst, wepRotation * Quaternion.Euler(eulerTweak.x, eulerTweak.y, eulerTweak.z), arcLen,
                weaponSystem.firingArcSettings.minVerticalRotationAngle * Mathf.Deg2Rad,
                weaponSystem.firingArcSettings.maxVerticalRotationAngle * Mathf.Deg2Rad,
                configs.discColorsVerticalPie.CreateColors());
    }

    // Start is called before the first frame update
    void Start()
    {
        weaponSystem = GetComponent<WeaponController>();
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}

[Serializable]
public class DiscColorsProp
{
    /// <summary>The color on the inside at the start angle</summary>
    public Color innerStart;

    /// <summary>The color on the outside at the start angle</summary>
    public Color outerStart;

    /// <summary>The color on the inside at the end angle</summary>
    public Color innerEnd;

    /// <summary>The color on the outside at the end angle</summary>
    public Color outerEnd;

    public ColorType colorType = ColorType.Flat;


    public DiscColors CreateColors()
    {
        if(colorType == ColorType.Angular)
        {
            return DiscColors.Angular(innerStart, innerEnd);
        }
        else if (colorType == ColorType.Bilinear)
        {
            return DiscColors.Bilinear(innerStart, outerStart, innerEnd, outerEnd);
        }
        else if (colorType == ColorType.Radial)
        {
            return DiscColors.Radial(innerStart, outerStart);
        }
        else
        {
            return DiscColors.Flat(innerStart);
        }
    }

    public static DiscColors CreateColors(DiscColorsProp props, Color healthColor)
    {
        if(props.colorType == ColorType.Angular)
        {
            return DiscColors.Angular(props.innerStart, healthColor);
        }
        else if (props.colorType == ColorType.Bilinear)
        {
            return DiscColors.Bilinear(props.innerStart, healthColor, props.innerEnd, healthColor);
        }
        else if (props.colorType == ColorType.Radial)
        {
            return DiscColors.Radial(props.innerStart, healthColor);
        }
        else
        {
            return DiscColors.Flat(healthColor);
        }
    }

    public enum ColorType
    {
        Angular, Bilinear, Flat, Radial
    }
    
}