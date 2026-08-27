using Shapes;
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[ExecuteAlways]
public class ShapeSpaceUtilities : ImmediateModeShapeDrawer
{

    public Action drawCmd;

    public override void DrawShapes(Camera cam)
    {
        using (Draw.Command(cam, UnityEngine.Rendering.Universal.RenderPassEvent.BeforeRenderingTransparents))
        {
            drawCmd?.Invoke();
        }
    }
}
