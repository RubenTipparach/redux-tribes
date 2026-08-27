using System.Collections;
using UnityEngine;

[ExecuteAlways]
[RequireComponent(typeof(ShapeSpaceUtilities))]
public abstract class BaseOverlay : MonoBehaviour
{
    public ShapeSpaceUtilities shapeSpaceUtilities;

    //public CustomLineProperties customLineProperties;


    protected virtual void OnEnable()
    {

        if (shapeSpaceUtilities == null)
            shapeSpaceUtilities = GetComponent<ShapeSpaceUtilities>();

        shapeSpaceUtilities.drawCmd = DrawLine;
    }

    protected virtual void OnDisable()
    {
        shapeSpaceUtilities.drawCmd = null;
    }

    protected abstract void DrawLine();
}

