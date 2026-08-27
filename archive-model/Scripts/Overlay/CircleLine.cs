using Shapes;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[ExecuteAlways]
public class CircleLine : MonoBehaviour
{

    //public Disc circle;
    public ShapeSpaceUtilities shapeSpaceUtilities;
    public float radius = 5;

    public Transform trackingTarget;

    int lineSegments = 16;

    PolylinePath p;

    public CustomLineProperties friendlyProps;
    public CustomLineProperties enemyProps;

    public bool friendly = false;

    void Awake()
    {

    }

    // Start is called before the first frame update
    void Start()
    {
    }

    private void OnEnable()
    {
        p = new PolylinePath();

        for (int i = 0; i < lineSegments + 3; i++)
            p.AddPoint(-1, -1);

        if (shapeSpaceUtilities == null)
            shapeSpaceUtilities = GetComponent<ShapeSpaceUtilities>();

        shapeSpaceUtilities.drawCmd = DrawLine;
    }

    private void OnDisable()
    {
        p = new PolylinePath();
        shapeSpaceUtilities.drawCmd = null;
    }

    void DrawLine()
    {
        //var plane = GameManager.Instance.orbitShipCamera.target;

        if (trackingTarget == null) return;

        //Debug.Log("Drawing line " + trackingTarget.name);
        var planePosition = Vector3.Scale(trackingTarget.position, new Vector3(1, 0, 1));

        p.SetPoint(0, new PolylinePoint(transform.position));
        p.SetPoint(1, new PolylinePoint(planePosition));
        //circleLine.End = planePosition - trackingTarget.position;

        var lookDir = Vector3.Scale(trackingTarget.forward, new Vector3(1, 0, 1)).normalized;

        for (int i = 0; i < lineSegments; i++)
        {
            var heading =
                Quaternion.Euler(0, ((float)i / lineSegments) * 360f, 0) *
                lookDir * (radius);

            var position = heading + planePosition;

            //Debug.DrawLine(trackingTarget.transform.position, position, Color.white);

            p.SetPoint(2 + i, position);

        }

        p.SetPoint(lineSegments + 2, lookDir * (radius) + planePosition);

        var customLineProperties = friendly ? friendlyProps : enemyProps;

        if (customLineProperties != null)
        {
            Draw.LineGeometry = customLineProperties.lineGeometry;
            Draw.ThicknessSpace = customLineProperties.thicknessSpace;

            //Draw.Thickness = customLineProperties.lineThickness;

            Draw.Polyline(path: p, closed: false, thickness: customLineProperties.thickness,
                color: customLineProperties.color);
        }

    }
}
