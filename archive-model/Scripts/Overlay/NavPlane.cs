using System.Collections;
using System.Collections.Generic;
using Shapes;
using UnityEngine;

[ExecuteAlways]
[RequireComponent(typeof(ShapeSpaceUtilities))]
public class NavPlane : MonoBehaviour
{
    ShapeSpaceUtilities drawer;
    void Start()
    {
        drawer = GetComponent<ShapeSpaceUtilities>();
        drawer.drawCmd = DrawShapes;
    }

    public int dotCount = 1000;
    public float gridSpacing = 1f;
    public float fadeDistance = 10f;
    public float dotSize = 0.05f;
    public Color dotColor = Color.white;

    public Color elevationColor;
    public float thicknessRing = 1;
    public float ringSize = 10;
    public float lineThickness = 2;
    // Used to ensure a consistent grid across movement
    private Vector3 cachedCenter;

    private void Update()
    {
        // Snap current world position to nearest int on XZ plane
        Vector3 pos = transform.position;
        cachedCenter = new Vector3(
            Mathf.Round(pos.x / gridSpacing) * gridSpacing,
            0f,
            Mathf.Round(pos.z / gridSpacing) * gridSpacing
        );
    }

    public void DrawShapes()
    {
        Draw.Matrix = Matrix4x4.identity;

        int drawn = 0;
        int halfGridSize = Mathf.CeilToInt(Mathf.Sqrt(dotCount) / 2f);

        for (int x = -halfGridSize; x <= halfGridSize && drawn < dotCount; x++)
        {
            for (int z = -halfGridSize; z <= halfGridSize && drawn < dotCount; z++)
            {
                Vector3 dotPos = cachedCenter + new Vector3(x * gridSpacing, 0f, z * gridSpacing);

                float dist = Vector3.Distance(dotPos, cachedCenter);
                float alpha = Mathf.Clamp01(1f - dist / fadeDistance);

                Color finalColor = new Color(dotColor.r, dotColor.g, dotColor.b, dotColor.a * alpha);
                Draw.Disc(dotPos, Vector3.up, dotSize, finalColor);

                drawn++;
            }
        }

        var start = transform.position;
        var end = new Vector3(transform.position.x, 0, transform.position.z);
        Draw.Ring(start, Vector3.up, ringSize, thicknessRing, elevationColor);
        Draw.Ring(end, Vector3.up, ringSize, thicknessRing, elevationColor);


        Draw.ThicknessSpace = ThicknessSpace.Pixels;
        Draw.LineGeometry = LineGeometry.Volumetric3D;
        Draw.Line(start, end, lineThickness, elevationColor);

    }
}
