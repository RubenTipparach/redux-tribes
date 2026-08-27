using System.Collections;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEditor;
using UnityEngine;

[ExecuteAlways]
public class WaypointVisualizer : MonoBehaviour
{

    public DirectionWaypoint direction = DirectionWaypoint.CW;
    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }

#if UNITY_EDITOR
    private void OnDrawGizmos()
    {
        Vector3 transformPositionStarting = transform.position;
        Gizmos.color = direction == DirectionWaypoint.CW ? Color.cyan : Color.green;

        foreach (Transform t in transform)
        {
            Gizmos.DrawLine( transformPositionStarting, t.position);
            Handles.DrawWireCube(t.position, Vector3.one);
            transformPositionStarting = t.position;
        }
    }
#endif
}


public enum DirectionWaypoint {
    CCW = 1,
    CW = 2
}