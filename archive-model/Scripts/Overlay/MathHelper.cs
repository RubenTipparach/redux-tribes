using Shapes;
using System;
using UnityEngine;

public static class MathHelper
{
    public static (Vector3, Vector3) IntersectionPoint(Vector3 p1, Vector3 p2, Vector3 center, float radius)
    {
        Vector3 dp = new Vector3();
        float a, b, c;
        float bb4ac;
        float mu1;
        float mu2;

        //  get the distance between X and Z on the segment
        dp.x = p2.x - p1.x;
        dp.z = p2.z - p1.z;

        //   I don't get the math here
        a = dp.x * dp.x + dp.z * dp.z;
        b = 2 * (dp.x * (p1.x - center.x) + dp.z * (p1.z - center.z));
        c = center.x * center.x + center.z * center.z;
        c += p1.x * p1.x + p1.z * p1.z;
        c -= 2 * (center.x * p1.x + center.z * p1.z);
        c -= radius * radius;
        bb4ac = b * b - 4 * a * c;
        if (Mathf.Abs(a) < float.Epsilon || bb4ac < 0)
        {
            //  line does not intersect
            return (Vector3.zero, Vector3.zero);
        }
        mu1 = (-b + Mathf.Sqrt(bb4ac)) / (2 * a);
        mu2 = (-b - Mathf.Sqrt(bb4ac)) / (2 * a);
        var aPoint = new Vector3(p1.x + mu1 * (p2.x - p1.x), 0, p1.z + mu1 * (p2.z - p1.z));
        var bPoint = new Vector3(p1.x + mu2 * (p2.x - p1.x), 0, p1.z + mu2 * (p2.z - p1.z));

        return (aPoint, bPoint);
    }
}