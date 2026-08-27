
using UnityEngine;

public static class ArcTest
{

    public static bool TargetArcTest(Transform myship, Vector3 targetPosition, float startDegree, float stopDegree)
    {
        Vector3 leftArcNormalized = Quaternion.Euler(0, startDegree, 0) * myship.forward;
        Vector3 RightArcNormalized = Quaternion.Euler(0, stopDegree, 0) * myship.forward;
        Vector3 targetNormalized = (targetPosition - myship.position).normalized;

        //Debug.DrawLine(myship.position, leftArcNormalized * 5 + myship.position, Color.yellow, 5);
        //Debug.DrawLine(myship.position, RightArcNormalized * 5 + myship.position, Color.yellow, 5);

        var offset = (stopDegree - startDegree);

        if (offset == 360f) return true;

        var testResult = TargetArcTest(leftArcNormalized, RightArcNormalized, targetNormalized, offset, Vector3.zero);

        return testResult;
    }

    public static bool TargetArcTest(Vector3 myPosition, Vector3 myForward, 
        Vector3 targetPosition, float startDegree, float stopDegree, bool debug = false)
    {
        Vector3 leftArcNormalized = Quaternion.Euler(0, startDegree, 0) * myForward;
        Vector3 RightArcNormalized = Quaternion.Euler(0, stopDegree, 0) * myForward;
        Vector3 targetNormalized = (targetPosition - myPosition).normalized;

        if (debug)
        {
            Debug.DrawLine(myPosition, myPosition + leftArcNormalized * 5 + myForward, Color.yellow, 5);
            Debug.DrawLine(myPosition, myPosition + RightArcNormalized * 5 + myForward, Color.yellow, 5);
        }

        var offset = (stopDegree - startDegree);

        if (offset == 360f) return true;

        var testResult = TargetArcTest(leftArcNormalized, RightArcNormalized, targetNormalized, offset, Vector3.zero);

        return testResult;
    }

    public static bool TargetArcTest(Vector3 leftVector, Vector3 rightVector, Vector3 targetVector, float actualAngle, Vector3 offset)
    {
        float angle = actualAngle;
        float halfAngle = angle / 2f;

        Vector3 midWayVector = Quaternion.Euler(0, -halfAngle, 0) * leftVector;
        float minRangeUnit = Vector3.Dot(midWayVector, rightVector);
        float targetRangeUnit = Vector3.Dot(midWayVector, targetVector);

        //Debug.DrawLine(offset, offset + leftVector, Color.yellow);
        //Debug.DrawLine(offset, offset + midWayVector, Color.blue);
        //Debug.DrawLine(offset, offset + rightVector, Color.yellow);
        //Debug.DrawLine(offset, offset +targetVector, Color.red);

        return (targetRangeUnit >= minRangeUnit);
    }


    public static bool TargetArcTestVertical(Vector3 leftVector, Vector3 rightVector, Vector3 targetVector, float actualAngle, Vector3 offset)
    {
        float angle = actualAngle;
        float halfAngle = angle / 2f;

        Vector3 midWayVector = Quaternion.Euler(halfAngle, 0, 0) * rightVector;
        float minRangeUnit = Vector3.Dot(midWayVector, rightVector);
        float targetRangeUnit = Vector3.Dot(midWayVector, targetVector);

        //Debug.DrawLine(offset, offset + leftVector, Color.yellow);
        //Debug.DrawLine(offset, offset + midWayVector, Color.blue);
        //Debug.DrawLine(offset, offset + rightVector, Color.yellow);
        //Debug.DrawLine(offset, offset + targetVector, Color.red);

        return (targetRangeUnit >= minRangeUnit);
    }

    public static bool TargetArcTest3D(Transform turret,
    Vector3 targetPosition,
    
    float horizontalStartDegree,
    float horizontalStopDegree,

    float verticalStartDegree,
    float verticalStopDegree,

    bool debug = false)
    {
        return TargetArcTest3D(
            turret.position,
            turret.rotation,
            targetPosition,

            horizontalStartDegree,
            horizontalStopDegree,

            verticalStartDegree,
            verticalStopDegree,

            debug);
    }

    // this is a pure utility function.
    public static bool TargetArcTest3D(
        Vector3 turretPosition,
        Quaternion turretRotation,
        Vector3 targetPosition,
        
        float horizontalStartDegree,
        float horizontalStopDegree,

        float verticalStartDegree,
        float verticalStopDegree,

        bool debug = false)
    {
        var myPosition = turretPosition;
        var orientation = turretRotation;

        (var upVector, var rightVector) = orientation.GetUpAndRightVectors();

        //horizotnal
        Vector3 leftArcNormalized = Quaternion.Euler(0, horizontalStartDegree, 0)  * Vector3.forward;
        Vector3 RightArcNormalized = Quaternion.Euler(0, horizontalStopDegree, 0) * Vector3.forward;

        // vertical
        Vector3 bottomArcNormalized = Quaternion.Euler(verticalStartDegree, 0, 0) * Vector3.forward;
        Vector3 topArcNormalized = Quaternion.Euler(verticalStopDegree, 0, 0) * Vector3.forward;

        Vector3 targetNormalized = (targetPosition - myPosition).normalized;

        Vector3 flattenedXZTarget = Quaternion.Inverse(orientation) * Vector3.ProjectOnPlane(targetNormalized, upVector).normalized; // horizontal
        Vector3 flattenedYZTarget = Quaternion.Inverse(orientation) * Vector3.ProjectOnPlane(targetNormalized, rightVector).normalized; // vertical

        var hOffset = (horizontalStartDegree - horizontalStopDegree);
        var yOffset = (verticalStartDegree - verticalStopDegree);

        bool testResultXZ = hOffset >= 360f || TargetArcTest(leftArcNormalized, RightArcNormalized, flattenedXZTarget, hOffset, Vector3.zero); // horizontal
        bool testResultYZ = yOffset >= 360f || TargetArcTestVertical(bottomArcNormalized, topArcNormalized, flattenedYZTarget, yOffset, Vector3.left * 4);// vertical

        if (debug)
        {
            Debug.DrawLine(myPosition, myPosition + orientation * leftArcNormalized * 2f, Color.yellow, 1);
            Debug.DrawLine(myPosition, myPosition + orientation * RightArcNormalized * 2f, Color.yellow, 1);

            Debug.DrawLine(myPosition, myPosition + orientation * bottomArcNormalized * 2f, Color.cyan, 1);
            Debug.DrawLine(myPosition, myPosition + orientation * topArcNormalized * 2f, Color.cyan, 1);

            if (testResultXZ) Debug.DrawLine(myPosition, myPosition + orientation * flattenedXZTarget * 2f, Color.red, 1);
            if (testResultXZ) Debug.DrawLine(myPosition, myPosition + orientation * flattenedYZTarget * 2f, Color.green, 1);

        }
        return testResultXZ && testResultYZ;
        //return testResultYZ;
    }

}


public static class QuaternionExtensions
{
    // Extension method for Quaternion
    public static (Vector3 up, Vector3 right) GetUpAndRightVectors(this Quaternion quaternion)
    {
        Vector3 upVector = quaternion * Vector3.up;    // Up vector
        Vector3 rightVector = quaternion * Vector3.right; // Right vector

        return (upVector, rightVector);
    }
}