using System.Collections;
using System.Collections.Generic;
using UnityEngine;
public class OrbitShipCamera : MonoBehaviour
{

    //Ship orbitObject;
    public Camera mainCamera;

    Transform cameraTransform => mainCamera.transform;
    public Transform target;

    public Transform targetPlaneRotation;

    [Header("Position")]
    public float distanceMin = 10;
    public float distanceMax = 30;
    public float yOffset = 0;
    public float scrollSensitivity = 1000;
    public float scrollSmoothing = 10;

    [Header("Rotation")]
    public float tiltMin = -85;
    public float tiltMax = 85;
    public float rotationSensitivity = 0.25f;
    public float rotationSpeed = 20;

    public float distance;
    private float scrollDistance;
    private float velocity;
    private float lookAngle;
    private float tiltAngle;
    private Quaternion rotation;

    //	public InputMaster screenTap;

    public bool rightMousePressed = false;

    public bool lockedCamera = false;

    public Transform secondaryTarget;

    public AnimationCurve centerHeight;

    public Vector3 pivotOffset;
    public Vector3 pivotOffset2;

    public Vector3 overallCameraOffset;

    public float maxFixedPivot = 5f;

    public Vector3 localCamPosition;
    public Quaternion localCamRotation;

    float timeDeltaCustom = 0;

    public float ZoomRatio => distance / distanceMax;

    protected void Awake()
    {
        tiltAngle = (tiltMin + tiltMax) / 2;
        //distance = scrollDistance = (distanceMax + distanceMin) / 2;

        // get this infor from current rotation
        tiltAngle = cameraTransform.rotation.eulerAngles.x;
        lookAngle = cameraTransform.rotation.eulerAngles.y;

        cameraTransform.rotation = rotation = transform.rotation * Quaternion.Euler(tiltAngle, lookAngle, 0);
        cameraTransform.position = CalculateCameraPosition();

        if (cameraTransform == null || target == null)
        {
            cameraTransform.GetComponentInChildren<Camera>().enabled = false;
            return;
        }
        scrollDistance = 10;
        //InitCamera();
    }

    public void SetupCamera(Transform target, Transform inputCamera)
    {
        this.cameraTransform.position = inputCamera.position;
        this.cameraTransform.rotation = inputCamera.rotation;
        tiltAngle = cameraTransform.rotation.eulerAngles.x;
        lookAngle = cameraTransform.rotation.eulerAngles.y;

        SetupCamera(target);
    }

    public void SetupCamera(Transform target)
    {
        this.target = target;
        //pivotOffset = target.localPosition;
        //distance = scrollDistance = Vector3.Distance(cameraTransform.position, target.parent.position + pivotOffset);
        //distance = scrollDistance = Vector3.Distance(cameraTransform.position, target.position + pivotOffset);
        cameraTransform.GetComponentInChildren<Camera>().enabled = true;
        scrollDistance = Vector3.Distance(cameraTransform.position, target.position + pivotOffset);
        distance = scrollDistance;
        transform.position = target.position;
        //cameraTransform.position = CalculateCameraPosition();
        UpdateCamera(-1);

        Debug.Log("set camera at taget;");
    }

    public void UnsetCamera()
    {
        cameraTransform.GetComponentInChildren<Camera>().enabled = false;
        target = null;
    }

    public void SetSecondaryTarget(Transform secondaryTarget)
    {
        this.secondaryTarget = secondaryTarget;
        lockedCamera = true;
    }

    // Update is called every frame, if the MonoBehaviour is enabled.
    protected void Update()
    {
        if (Input.GetMouseButtonDown(1))
        {
            //Debug.Log("Right Mouse Clicked");
            rightMousePressed = true;
            lockedCamera = false;
        }

        if (Input.GetMouseButtonUp(1))
        {
            rightMousePressed = false;
            //Debug.Log("Right Mouse Released");
        }

        transform.rotation = targetPlaneRotation.rotation;

        //flybyParticleController.transform.position = target.position;
        //flybyParticleController.UpdateEffect(GameManager.Instance.selectedPlayerShip.velocity);
    }

    private void LateUpdate()
    {

        timeDeltaCustom = Time.unscaledDeltaTime;

        if (cameraTransform == null || target == null) return;

        // TODO: add a thing to the input system.
        float scroll = Input.GetAxis("Mouse ScrollWheel");

        // That dank camera lock like in Dark Souls.
        if (lockedCamera)
        {
            if (secondaryTarget == null)
            {
                lockedCamera = false;
                return;
            }

            Vector3 pivotModified = Vector3.up * centerHeight.Evaluate(distance / maxFixedPivot) * pivotOffset.y + overallCameraOffset;

            Vector3 currentTargetPosition = target.position + pivotModified;

            Vector3 normalDir = (secondaryTarget.position - currentTargetPosition).normalized;

            rotation = Quaternion.Inverse(transform.rotation) * transform.rotation * Quaternion.LookRotation(normalDir);
            if (cameraTransform.rotation != rotation)
            {
                cameraTransform.rotation = Quaternion.Lerp(cameraTransform.rotation, rotation,
                    timeDeltaCustom * rotationSpeed);
            }

            UpdateCamera(scroll);
        }
        // Mouse override should be simple.
        else
        {
            if (rightMousePressed)
            {
                OnDrag(GameManager.GameInput.MouseDelta);
            }
            rotation = transform.rotation * Quaternion.Euler(tiltAngle, lookAngle, 0);
            //if (cameraTransform.rotation != rotation)
            //{
            cameraTransform.rotation = Quaternion.Lerp(cameraTransform.rotation, rotation,
                timeDeltaCustom * rotationSpeed);
            //}

            UpdateCamera(scroll);
        }

    }

    private void UpdateCamera(float scroll)
    {


        if (scroll != 0)
        {
            scrollDistance -= scroll * Time.unscaledDeltaTime * scrollSensitivity;
            scrollDistance = Mathf.Clamp(scrollDistance, distanceMin, distanceMax);
        }

        if (distance != scrollDistance)
        {
            distance = Mathf.SmoothDamp(distance, scrollDistance, ref velocity, Time.unscaledDeltaTime * scrollSmoothing);
        }

        cameraTransform.position = CalculateCameraPosition();
    }

    Vector2 lastMousePosition;

    public void OnDrag(Vector2 delta)
    {
        //if (cameraTransform == null || target == null) return;
        // screenTap.Player.PointerDelta.ReadValue<Vector2>();		
        //Debug.Log(delta);

        lookAngle += delta.x * rotationSensitivity;
        tiltAngle -= delta.y * rotationSensitivity;
        tiltAngle = Mathf.Clamp(tiltAngle, tiltMin, tiltMax);
    }

    private Vector3 CalculateCameraPosition()
    {
        if (target == null)
        {
            return Vector3.zero;
        }

        Vector3 pivotModified = Vector3.up * centerHeight.Evaluate(distance / maxFixedPivot) * pivotOffset.y + overallCameraOffset;
        pivotOffset2 = pivotModified;
        Vector3 currentTargetPosition = target.position + pivotModified;

        return currentTargetPosition + (cameraTransform.rotation * (Vector3.back * distance) + Vector3.up * yOffset);
    }

    public void SetZoomDistance(float distance)
    {
        
    }

    //.... select the target...
    public void SelectTarget()
    {
        lockedCamera = true;
    }

    private void OnEnable()
    {
        mainCamera.transform.position = localCamPosition;
        mainCamera.transform.rotation = localCamRotation;
        mainCamera.transform.parent = this.transform;

        //flybyParticleController.gameObject.SetActive(true);
    }

    private void OnDisable()
    {
        localCamPosition = mainCamera.transform.position;
        localCamRotation = mainCamera.transform.rotation;
        //flybyParticleController.gameObject.SetActive(false);
    }
}
