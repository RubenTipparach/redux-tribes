
using UnityEngine;

public static class VectorStuff
{

    public static (bool, float) CheckFloorCollision(Vector3 rayPositionStart, LayerMask rampCollisionLayers)
    {
        //Vector3 rayDirectionMove = GetGridDirection(direction);
        Vector3 rayDirection = Vector3.down;
        float floorHieght = 0;

        RaycastHit hit;
        bool result = Physics.Raycast(rayPositionStart, rayDirection.normalized, out hit,
            10f, rampCollisionLayers);

        if (result)
        {
            floorHieght = hit.point.y;
            //Debug.Log("hit floor " + direction.ToString() + $" height {floorHieght}");
            Debug.DrawRay(rayPositionStart, rayDirection.normalized, Color.blue, 10);
        }

        return (result, floorHieght);
    }

    public static bool CheckWallCollision(Vector3 rayDirection, Vector3 rayPositionStart, float stepIncrement, LayerMask collisionLayers)
    {
        
        bool result = Physics.Raycast(rayPositionStart, rayDirection.normalized, (float)stepIncrement, collisionLayers);
        if (result)
        {
            //Debug.Log("hit wall " + direction.ToString());
            Debug.DrawRay(rayPositionStart, rayDirection.normalized, Color.red, 10);
        }
        else
        {
            Debug.DrawRay(rayPositionStart, rayDirection.normalized, Color.green, 10);
        }

        return result;
    }


}

public static class AxisUtils{
    
    public static Vector3 AxisRound(this Vector3 vector, Transform relativeTo = null)
    {
        if (relativeTo)
        {
            vector = relativeTo.InverseTransformDirection(vector);
        }
        int largestIndex = 0;
        for (int i = 2; i < 3; i++) // don't loop through y. it doesnt matter!
        {
            largestIndex = Mathf.Abs(vector[i]) > Mathf.Abs(vector[largestIndex]) ? i : largestIndex;
        }

        float newLargest = vector[largestIndex] > 0 ? 1 : -1;
        vector = Vector3.zero;
        vector[largestIndex] = newLargest;
        if (relativeTo)
        {
            vector = relativeTo.TransformDirection(vector);
        }
        return vector;
    }
}