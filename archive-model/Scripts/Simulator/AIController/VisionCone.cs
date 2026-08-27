using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine;

public class VisionCone : MonoBehaviour
{
    //public Transform playerShip; // Assign the player ship transform in the inspector
    public float visionRange = 100f;
    public float horizontalAngle = 30f;
    public float verticalAngle = 30f;
    public LayerMask obstacleLayers; // Assign layers considered as obstacles

    public Transform rayOrigin;

    public void CheckTargetInVisionCone(Transform target)
    {
        Vector3 toTarget = target.position - rayOrigin.position;
        float distanceToTarget = toTarget.magnitude;
        if (distanceToTarget <= visionRange)
        {
            // Normalize vector toTarget
            toTarget.Normalize();

            // Check horizontal and vertical vision
            //float horizontalDot = Vector3.Dot(toTarget, rayOrigin.right);
            //float verticalDot = Vector3.Dot(toTarget, rayOrigin.up);
            //bool withinHorizontal = Mathf.Acos(horizontalDot) * Mathf.Rad2Deg <= horizontalAngle / 2f;
            //bool withinVertical = Mathf.Acos(verticalDot) * Mathf.Rad2Deg <= verticalAngle / 2f;


            var isInArc = ArcTest.TargetArcTest3D(
                rayOrigin,
                target.position,
                horizontalAngle,
                -horizontalAngle,
                verticalAngle, -verticalAngle);



            // If within cone angles, check for obstacles
            if (isInArc)
            {
                RaycastHit hit;
                // Cast a ray from the spaceship towards the target
                if (Physics.Raycast(rayOrigin.position, toTarget, out hit, visionRange, obstacleLayers))
                {
                    // Check if the ray hit the intended target
                    if (hit.transform == target)
                    {
                        Debug.Log(target.name + " detected within vision cone!");
                        Debug.DrawRay(rayOrigin.position, toTarget * visionRange, Color.green, 10f);
                        var ai = GetComponent<BaseAIController>();
                        ai.stealthDetectionBehavior.hasDetectedEnemy = true;

                    }
                    else
                    {
                        Debug.Log("View of " + target.name + " is obstructed by " + hit.transform.name);
                        Debug.DrawRay(rayOrigin.position, toTarget * visionRange, Color.red, 10f);

                    }
                }
                else
                {
                    // Debug.Log("View of " + target.name + " is obstructed by " + hit.transform.name);
                    Debug.DrawRay(rayOrigin.position, toTarget * visionRange, Color.red, 10f);
                }
            }
        }
        else
        {
            Debug.Log("sorry, player not in Line Of Sight");
        }
    }

    void VisualizeCone()
    {
        // Calculate direction vectors at the bounds of the vision cone
        Vector3 horizontalBound1 = rayOrigin.rotation * (Quaternion.Euler(0, -horizontalAngle / 2, 0) * Vector3.forward) * visionRange;
        Vector3 horizontalBound2 = rayOrigin.rotation * (Quaternion.Euler(0, horizontalAngle / 2, 0) * Vector3.forward) * visionRange;
        Vector3 verticalBound1 = rayOrigin.rotation * (Quaternion.Euler(-verticalAngle / 2, 0, 0) * Vector3.forward) * visionRange;
        Vector3 verticalBound2 = rayOrigin.rotation * (Quaternion.Euler(verticalAngle / 2, 0, 0) * Vector3.forward) * visionRange;

        // Draw lines from spaceship to the bounds of the vision cone
        Debug.DrawLine(rayOrigin.position, rayOrigin.position + horizontalBound1, Color.cyan);
        Debug.DrawLine(rayOrigin.position, rayOrigin.position + horizontalBound2, Color.cyan);
        Debug.DrawLine(rayOrigin.position, rayOrigin.position + verticalBound1, Color.blue);
        Debug.DrawLine(rayOrigin.position, rayOrigin.position + verticalBound2, Color.blue);
    }


    private void OnDrawGizmos()
    {
        if (rayOrigin != null)
        {
            // Visualize the vision cone
            VisualizeCone();
        }
    }
}
