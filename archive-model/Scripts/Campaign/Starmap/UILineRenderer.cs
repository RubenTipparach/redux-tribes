using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

// PointPair class for holding the start and end points of a line
[System.Serializable]
public struct PointPair
{
    public Vector2 start;
    public Vector2 end;
    public Color? color;

    public PointPair(Vector2 start, Vector2 end, Color? assignedColor)
    {
        this.start = start;
        this.end = end;
        this.color = assignedColor;
    }
}

// Line drawing class that extends MaskableGraphic
public class UILineRenderer : MaskableGraphic
{
    // List of point pairs to draw lines between
    public List<PointPair> linePoints = new List<PointPair>();

    // Thickness of the line
    public float thickness = 5f;

    // Number of segments to use for the rounded caps
    public int segments = 10;

    public void SetPoints(List<PointPair> points){
        linePoints = points;
        SetVerticesDirty();

    }

    protected override void OnPopulateMesh(VertexHelper vh)
    {
        vh.Clear();

        // Iterate through each PointPair and render each line
        foreach (PointPair pair in linePoints)
        {
            DrawLineWithRoundedCaps(pair.start, pair.end, vh, pair.color.HasValue ? pair.color.Value : color);
        }
    }

    // Method to draw a line with rounded caps at both ends
    private void DrawLineWithRoundedCaps(Vector2 start, Vector2 end, VertexHelper vh, Color setColor)
    {
        Vector2 direction = (end - start).normalized;
        Vector2 perpendicular = new Vector2(-direction.y, direction.x) * thickness * 0.5f;

        // Define the four vertices of the quad (two parallel lines to form thickness)
        Vector2 v0 = start - perpendicular;
        Vector2 v1 = start + perpendicular;
        Vector2 v2 = end + perpendicular;
        Vector2 v3 = end - perpendicular;

        // Calculate UV coordinates (simple case, can be modified)
        UIVertex[] vertices = new UIVertex[4];
        vertices[0] = CreateVertex(v0, new Vector2(0, 0), setColor);
        vertices[1] = CreateVertex(v1, new Vector2(0, 1), setColor);
        vertices[2] = CreateVertex(v2, new Vector2(1, 1), setColor);
        vertices[3] = CreateVertex(v3, new Vector2(1, 0), setColor);

        // Add quad to VertexHelper
        vh.AddUIVertexQuad(vertices);

        // Add rounded cap at the start
        DrawRoundedCap(start, -direction, vh, setColor);

        // Add rounded cap at the end
        DrawRoundedCap(end, direction, vh, setColor);
    }

    // Method to draw a rounded cap at the end of a line
    private void DrawRoundedCap(Vector2 center, Vector2 direction, VertexHelper vh, Color setColor)
    {
        float angleStep = Mathf.PI / segments; // Angle between each segment (half-circle)
        Vector2 perpendicular = new Vector2(-direction.y, direction.x) * (thickness * 0.5f);

        // Starting point for the cap (this will be on the edge of the line segment)
        Vector2 startCapPoint = center + perpendicular;

        UIVertex centerVertex = CreateVertex(center, new Vector2(0.5f, 0.5f), setColor); // Center point of the circle

        // Add vertices around the semi-circle
        for (int i = 0; i <= segments; i++)
        {
            float currentAngle = i * angleStep;
            Vector2 currentDirection = new Vector2(
                Mathf.Cos(currentAngle) * perpendicular.x - Mathf.Sin(currentAngle) * perpendicular.y,
                Mathf.Sin(currentAngle) * perpendicular.x + Mathf.Cos(currentAngle) * perpendicular.y
            );

            Vector2 capVertexPosition = center + currentDirection;

            UIVertex capVertex = CreateVertex(capVertexPosition, new Vector2(0.5f + Mathf.Cos(currentAngle) * 0.5f, 0.5f + Mathf.Sin(currentAngle) * 0.5f), setColor);

            if (i > 0)
            {
                // Draw triangle between center, previous point, and current point
                vh.AddVert(centerVertex);
                vh.AddVert(CreateVertex(center + new Vector2(
                    Mathf.Cos((i - 1) * angleStep) * perpendicular.x - Mathf.Sin((i - 1) * angleStep) * perpendicular.y,
                    Mathf.Sin((i - 1) * angleStep) * perpendicular.x + Mathf.Cos((i - 1) * angleStep) * perpendicular.y),
                    new Vector2(0, 0), setColor)
                );
                vh.AddVert(capVertex);
                vh.AddTriangle(vh.currentVertCount - 3, vh.currentVertCount - 2, vh.currentVertCount - 1);
            }
        }
    }

    // Helper method to create UIVertex
    private UIVertex CreateVertex(Vector2 position, Vector2 uv, Color setColor)
    {
        UIVertex vertex = UIVertex.simpleVert;
        vertex.position = position;
        vertex.color = setColor; // Set color from MaskableGraphic
        vertex.uv0 = uv;
        return vertex;
    }
}