using System.Collections;
using System.Collections.Generic;
using Shapes;
using Unity.VisualScripting;
using UnityEngine;
using UnityEngine.Events;

[ExecuteInEditMode]
[RequireComponent(typeof(ShapeSpaceUtilities))]
public class Waypoint : GenericMission
{


    public string missionTextTemplate = "At least 1 ship must reach the waypoint.";

    public override string GenerateMissionText()
    {
        return missionTextTemplate;
    }

    public ShapeSpaceUtilities drawer;
    
    public bool triggerBoxEntered = false;

    public bool disableObjectOnTrigger = false;

    public bool drawWaypoint = true;

    public CustomLineProperties wayPointSphere;
    public CustomLineProperties waypointMarkers;

    public float markerLineLen = 10;
    public bool fillSphere = true;
    public float ringThickness = 2;
    public bool closeSphereOnEntered = true;

    public UnityEvent<GameObject> onEscortShipEntered;
    
    void Start()
    {

        if(drawer == null)
        {
            drawer = GetComponent<ShapeSpaceUtilities>();
        }

        drawer.drawCmd = Drawing;
    }

    void DrawMarker(Vector3 direction, float sphereRaidus)
    {
        Draw.Line(transform.position + direction * sphereRaidus,
        transform.position + direction * sphereRaidus + direction * markerLineLen,
        waypointMarkers.color);
    }
    void Drawing()
    {
        if (drawWaypoint && waypointMarkers != null && wayPointSphere != null)
        {
            float sphereRaidus = transform.localScale.x / 2f;
            if (fillSphere)
            {
                Draw.Sphere(transform.position, sphereRaidus, wayPointSphere.color);
            }

            waypointMarkers.DrawNormal();
            DrawMarker(transform.forward, sphereRaidus);
            DrawMarker(-transform.forward, sphereRaidus);
            DrawMarker(transform.right, sphereRaidus);
            DrawMarker(-transform.right, sphereRaidus);
            DrawMarker(transform.up, sphereRaidus);
            DrawMarker(-transform.up, sphereRaidus);

            Draw.Arc(pos: transform.position,
                radius: sphereRaidus,
                
                angleRadStart: 0,
                angleRadEnd: 360,
                colors: waypointMarkers.color,
                thickness: waypointMarkers.thickness);


            Draw.Arc(pos: transform.position,
                radius: sphereRaidus,
                rot: transform.rotation * Quaternion.Euler(90, 0, 0),
                angleRadStart: 0,
                angleRadEnd: 360,
                colors: waypointMarkers.color,
                thickness: ringThickness);

            Draw.Arc(pos: transform.position,
                radius: sphereRaidus,
                rot: transform.rotation * Quaternion.Euler(0, 90, 0),
                angleRadStart: 0,
                angleRadEnd: 360,
                colors: waypointMarkers.color,
                thickness: ringThickness);

        }
    }

    void OnTriggerEnter(Collider other){
        if (closeSphereOnEntered)
        {
            var ship = other.attachedRigidbody.GetComponent<ShipController>();
            if (ship != null)
            {
                triggerBoxEntered = true;
                Debug.Log("Trigger Entered!");
                if (disableObjectOnTrigger)
                {
                    gameObject.SetActive(false);
                }
            }
        }

        if(onEscortShipEntered != null)
        {
            onEscortShipEntered?.Invoke(other.attachedRigidbody.gameObject);
        }
    }

    public override bool CheckMissionGoald()
    {
        onCheckEvent?.Invoke();
        Debug.Log(" is trigger entereed?" + triggerBoxEntered);
        return triggerBoxEntered;
    }
}
