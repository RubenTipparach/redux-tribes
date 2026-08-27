using Shapes;
using System;
using UnityEngine;

[CreateAssetMenu(fileName = "LineProp", menuName = "Overlay/LineProp", order = 0)]
public class CustomLineProperties : ScriptableObject
{
    [ColorUsage(true, true)]
    public Color color;

    public float thickness = .1f;

    public LineGeometry lineGeometry = LineGeometry.Billboard;
    public ThicknessSpace thicknessSpace = ThicknessSpace.Pixels;

    public bool hasDash = false;

    public float DashOffset = 1;
    public float DashSize = 1;

    
    public float DashSpacing = 1;
    public float DashShape= 1;
    public void DrawNormal(){
            Draw.LineGeometry = lineGeometry;
            Draw.ThicknessSpace = thicknessSpace;
            Draw.Thickness = thickness; // 4px wide
    }

    public void DrawDash(){
        if (hasDash)
        {
            Draw.UseDashes = true;
            Draw.DashOffset = DashOffset;
            Draw.DashSize = DashSize;
            //Draw.DashStyle = DashStyle.defaultDashStyleLine;
            Draw.DashSnap = DashSnapping.Tiling;
            Draw.DashSpace = DashSpace.Meters;
            Draw.DashSpacing = 1;
            Draw.DashShapeModifier = 1;
        }

    }

    public void DrawDots(){
        if (hasDash)
        {
            Draw.UseDashes = true;
            Draw.DashOffset = DashOffset;
            Draw.DashSize = DashSize;
            //Draw.DashStyle = DashStyle.defaultDashStyleRing;
            Draw.DashSnap = DashSnapping.Tiling;
            Draw.DashSpace = DashSpace.Meters;
            Draw.DashSpacing = DashSpacing;
            Draw.DashShapeModifier = DashShape;
        }

    }

}
