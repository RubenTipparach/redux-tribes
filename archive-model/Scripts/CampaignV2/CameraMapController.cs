using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public delegate void ZoomEvent(float zoomLevel);
public class CameraMapController : MonoBehaviour
{
    // Variables for panning
    public float basePanSpeed = 20f;
    public float rightClickPanSpeed = 100f;
    public float zoomSpeed = 10f;

    // Variables for zooming (camera movement along Z-axis)
    public float minZoomDistanceRatio = .2f;
    public float maxZoomDistance = 50f;
    public float zoomLevel = 0;
    // Variables for targeting
    public float moveSpeed = 5f;
    private bool isTargeting = false;
    private Transform targetObject;

    // Variables to store the original camera position and rotation
    private Vector3 originalPosition;
    private Quaternion originalRotation;
    private Camera cam;

    public AnimationCurve animationCurve;
    public float zoomFactor = 10;

    Vector3 panPositionStart;
    Vector3 panPositionCurrent;

    Vector3 cameraStartPosition;
    Plane mapPlane;
    bool camMoving = false;

    public Timing holdDownMouse;

    public float moveSensitivityThreshold = 1f;

    public float lerpSpeed = 1;
    public event ZoomEvent zoomeEvents;

    // Start is called before the first frame update
    void Start()
    {
        cam = Camera.main;

        // Store the original camera position and rotation
        originalPosition = Vector3.zero;
        originalRotation = cam.transform.rotation;

        //HandleZooming(-1);
        //zoomLevel =  Vector3.Distance(transform.localPosition, originalPosition);
        zoomLevel = 0;
        HandleZooming(0);

        panPositionStart = Vector3.zero;
        mapPlane = new Plane(Vector3.up, 0);
    }


    // Handles zooming by moving the camera forward/backward along its Z axis
    void HandleZooming(float scroll)
    {


        Vector3 direction = cam.transform.forward; // Get the camera's forward direction
        float currentDistance = Vector3.Distance(cam.transform.localPosition, originalPosition);
        float zoomRatio = currentDistance / maxZoomDistance;

        //Debug.Log("Distance " + currentDistance);
        //Debug.Log("ratio " + zoomRatio);

        // Calculate the new position based on zooming
        zoomLevel = zoomLevel - scroll * zoomFactor;
        zoomLevel = Mathf.Clamp(zoomLevel, minZoomDistanceRatio, 1f);

        CampaignV2.CampaignMap.Instance.playerShip.UpdateScale(zoomLevel);
        zoomeEvents?.Invoke(zoomLevel);

        Vector3 newPosition = originalPosition
            - direction * maxZoomDistance * animationCurve.Evaluate(zoomLevel);

        // Clamp the zoom distance to prevent zooming too far or too close
        float distance = Vector3.Distance(newPosition, originalPosition);
        if (distance > 1 && distance <= maxZoomDistance)
        {
            panPositionCurrent = Input.mousePosition;
            Ray rayFromCameraStart = Camera.main.ScreenPointToRay(panPositionStart);

            cam.transform.localPosition = newPosition;

            if (scroll > 0)
            {
                cameraStartPosition = transform.position;
                //ZoomToCurrentPosition(rayFromCameraStart, panPositionCurrent);
            }
            //Ray rayFromCameraCurrent = Camera.main.ScreenPointToRay(panPositionCurrent);
        }

    }


    void Update()
    {
        //float distanceFromOriginal = Vector3.Distance(cam.transform.position, originalPosition); // Calculate the zoom distance

        // Adjust the pan speed based on the zoom distance
        //float currentPanSpeed = AdjustSpeedBasedOnZoom(distanceFromOriginal);

        // HandlePanningAndWASD(currentPanSpeed);
        float scroll = Input.GetAxis("Mouse ScrollWheel");
        if (scroll != 0)
        {
            HandleZooming(scroll);
        }

        if (Input.GetMouseButtonDown(0))
        {

            // Ray rayFromCamera = Camera.main.ScreenPointToRay(Input.mousePosition);
            panPositionStart = Input.mousePosition;
            cameraStartPosition = transform.position;
            // if (mapPlane.Raycast(rayFromCamera, out float distance))
            // {
            //     // 4. Determine the exact point on the plane
            //     cameraStartPosition = transform.position;
            //     panPositionCurrent = panPositionStart;
            //     Debug.Log($"Mouse World Position: {panPositionStart}");
            // }
            holdDownMouse.Init();
            camMoving = true;
        }

        if (Input.GetMouseButtonUp(0))
        {
            camMoving = false;
        }

        if (camMoving && holdDownMouse.Completed())
        {
            panPositionCurrent = Input.mousePosition;

            //Ray rayFromCameraCurrent = Camera.main.ScreenPointToRay(panPositionCurrent);
            PanToCurrentPosition(panPositionStart, panPositionCurrent);
        }
    }

    void PanToCurrentPosition(Vector3 startP, Vector3 currentP) {
        Ray rayFromCameraStart = Camera.main.ScreenPointToRay(startP);
        Ray rayFromCameraCurrent = Camera.main.ScreenPointToRay(currentP);

        if (mapPlane.Raycast(rayFromCameraStart, out float distance1))
        {
            if (mapPlane.Raycast(rayFromCameraCurrent, out float distance2))
            {
                var start = rayFromCameraStart.GetPoint(distance1);
                var current = rayFromCameraCurrent.GetPoint(distance2);
                //Debug.DrawLine(start, current, Color.green);
                var distanceMov = Vector3.Distance(start, current);
                if (distanceMov > moveSensitivityThreshold )
                {
                    // transform.position = cameraStartPosition + (start - current);
                    transform.position = Vector3.Lerp(transform.position, cameraStartPosition + (start - current), Time.deltaTime*lerpSpeed);
                }
            }
        }
    }

    void ZoomToCurrentPosition(Ray ratStart, Vector3 currentP)
    {
        Ray rayFromCameraCurrent = Camera.main.ScreenPointToRay(currentP);

        if (mapPlane.Raycast(ratStart, out float distance1))
        {
            if (mapPlane.Raycast(rayFromCameraCurrent, out float distance2))
            {
                var start = ratStart.GetPoint(distance1);
                var current = rayFromCameraCurrent.GetPoint(distance2);
                //Debug.DrawLine(start, current, Color.green);
                transform.position = Vector3.Lerp(transform.position, cameraStartPosition + (start - current), Time.deltaTime*lerpSpeed);
            }
        }
    }
}
