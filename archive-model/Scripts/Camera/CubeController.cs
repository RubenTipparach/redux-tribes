using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System.Linq;
using System.Threading;

public class CubeController : MonoBehaviour
{

    public float moveSpeed = 10;

    float smoothVelocity;

    public float smoothTime = 10;

    float internalSpeed = 0;

    public Camera cam;

    public float lerpSpeed = 10;

    public bool useFixedUpdate = false;

    // public float snapThresh
    public Timing snapTimer;
    public bool snapped = false;

    public float snapThresh = .1f;

    (KeyCode, Vector3)[] controls = new[]{
            (KeyCode.W, Vector3.forward),
            (KeyCode.S, Vector3.back),
            (KeyCode.A, Vector3.left),
            (KeyCode.D, Vector3.right),
            (KeyCode.R, Vector3.up),
            (KeyCode.F, Vector3.down),
    };
    Vector3 directionMove;

    [SerializeField]
    private Transform followObj;

    public void SetFollowObj(Transform follower)
    {
        followObj = follower;
        snapped = false;
        snapTimer.StartTimerAt(0);
    }

    private void Start()
    {
        //var camDirection = Vector3.Scale(cam.transform.forward, new Vector3(1, 0, 1));
        //transform.forward = camDirection;
    }

    void Update()
    {
        bool smoothStart = false;

        foreach (var control in controls)
        {
            if (Input.GetKey(control.Item1))
            {
                smoothStart = true;
                directionMove += control.Item2;
                followObj = null;
            }
        }


        if (followObj == null)
        {
            directionMove = directionMove.normalized;

            var traget = smoothStart ? moveSpeed : 0f;

            internalSpeed = Mathf.SmoothDamp(internalSpeed, traget, ref smoothVelocity, smoothTime);

            var camDirection = Vector3.Scale(cam.transform.forward, new Vector3(1, 0, 1));
            var direction = Quaternion.LookRotation(camDirection) * directionMove;
            transform.Translate(direction * Time.unscaledDeltaTime * internalSpeed, Space.World);
        }
        else
        {
            if (!useFixedUpdate)
            {
                MoveToTarget();
            }
        }
    }

    private void FixedUpdate() {
        if(useFixedUpdate && followObj != null) {
            MoveToTarget();
        }
    }

    void MoveToTarget()
    {
        if(snapTimer.Completed())
        {
            snapped = true;
        }
        
        if (Vector3.Distance(transform.position, followObj.position) > snapThresh && !snapped)
        {
            transform.position = Vector3.Lerp(transform.position, followObj.position, lerpSpeed * Time.unscaledDeltaTime);
        }
        else
        {
            snapped = true;
            transform.position = followObj.position;
        }
        internalSpeed = 0;
    }
}
